//go:build js && wasm

// Package editor is the web platform adapter for the shared Go terrain engine.
// DOM and canvas calls are confined here; all terrain work goes through wgpu.
package editor

import (
	"encoding/json"
	"fmt"
	"strconv"
	"syscall/js"
)

var document = js.Global().Get("document")
var callbacks []js.Func

type eventBinding struct {
	target js.Value
	event  string
	fn     js.Func
}

var eventBindings []eventBinding

func clearEvents(root js.Value) {
	keep := eventBindings[:0]
	for _, b := range eventBindings {
		if exists(b.target) && exists(root) && b.target.Get("nodeType").Type() == js.TypeNumber && root.Call("contains", b.target).Bool() {
			b.target.Call("removeEventListener", b.event, b.fn)
			b.fn.Release()
		} else {
			keep = append(keep, b)
		}
	}
	eventBindings = keep
}

func element(id string) js.Value { return document.Call("getElementById", id) }
func query(s string) js.Value    { return document.Call("querySelector", s) }
func each(s string, f func(js.Value)) {
	list := document.Call("querySelectorAll", s)
	for i := 0; i < list.Length(); i++ {
		f(list.Index(i))
	}
}
func exists(v js.Value) bool { return !v.IsNull() && !v.IsUndefined() }
func create(tag, class, text string) js.Value {
	v := document.Call("createElement", tag)
	if class != "" {
		v.Set("className", class)
	}
	if text != "" {
		v.Set("textContent", text)
	}
	return v
}
func text(id, s string) {
	if v := element(id); exists(v) {
		v.Set("textContent", s)
	}
}
func hidden(id string, b bool) {
	if v := element(id); exists(v) {
		v.Set("hidden", b)
	}
}
func disabled(id string, b bool) {
	if v := element(id); exists(v) {
		v.Set("disabled", b)
	}
}
func value(id string) string {
	v := element(id)
	if !exists(v) {
		return ""
	}
	return v.Get("value").String()
}
func number(id string) float64 { v, _ := strconv.ParseFloat(value(id), 64); return v }
func checked(id string) bool   { v := element(id); return exists(v) && v.Get("checked").Bool() }
func setValue(id string, v any) {
	if el := element(id); exists(el) {
		el.Set("value", fmt.Sprint(v))
	}
}
func attribute(v js.Value, k string, x any) { v.Call("setAttribute", k, fmt.Sprint(x)) }
func on(v js.Value, event string, fn func(js.Value)) {
	if !exists(v) {
		return
	}
	cb := js.FuncOf(func(_ js.Value, args []js.Value) any {
		defer func() {
			if p := recover(); p != nil {
				showError(fmt.Errorf("%v", p))
			}
		}()
		e := js.Undefined()
		if len(args) > 0 {
			e = args[0]
		}
		fn(e)
		return nil
	})
	eventBindings = append(eventBindings, eventBinding{v, event, cb})
	v.Call("addEventListener", event, cb)
}
func click(id string, fn func()) { on(element(id), "click", func(js.Value) { fn() }) }
func showError(err error) {
	if err != nil {
		text("error", err.Error())
		hidden("error", false)
		js.Global().Get("console").Call("error", err.Error())
	} else {
		hidden("error", true)
	}
}
func jsObject(v any) js.Value {
	b, _ := json.Marshal(v)
	return js.Global().Get("JSON").Call("parse", string(b))
}
func fromJS(v js.Value, out any) error {
	return json.Unmarshal([]byte(js.Global().Get("JSON").Call("stringify", v).String()), out)
}
func await(p js.Value) (js.Value, error) {
	type result struct {
		v js.Value
		e error
	}
	ch := make(chan result, 1)
	ok := js.FuncOf(func(_ js.Value, a []js.Value) any { ch <- result{v: a[0]}; return nil })
	bad := js.FuncOf(func(_ js.Value, a []js.Value) any { ch <- result{e: fmt.Errorf("%s", a[0].String())}; return nil })
	p.Call("then", ok).Call("catch", bad)
	r := <-ch
	ok.Release()
	bad.Release()
	return r.v, r.e
}
func request(path, method string, body any, out any) error {
	opt := map[string]any{"method": method}
	if body != nil {
		b, e := json.Marshal(body)
		if e != nil {
			return e
		}
		opt["headers"] = map[string]any{"Content-Type": "application/json"}
		opt["body"] = string(b)
	}
	r, e := await(js.Global().Call("fetch", path, js.ValueOf(opt)))
	if e != nil {
		return e
	}
	v, e := await(r.Call("text"))
	if e != nil {
		return e
	}
	if !r.Get("ok").Bool() {
		var m map[string]any
		_ = json.Unmarshal([]byte(v.String()), &m)
		return fmt.Errorf("%s: %v", path, m["error"])
	}
	if out != nil {
		return json.Unmarshal([]byte(v.String()), out)
	}
	return nil
}
func download(data []byte, mime, name string) {
	a := js.Global().Get("Uint8Array").New(len(data))
	js.CopyBytesToJS(a, data)
	blob := js.Global().Get("Blob").New(js.ValueOf([]any{a}), js.ValueOf(map[string]any{"type": mime}))
	u := js.Global().Get("URL").Call("createObjectURL", blob)
	link := create("a", "", "")
	link.Set("href", u)
	link.Set("download", name)
	link.Call("click")
	var cb js.Func
	cb = js.FuncOf(func(js.Value, []js.Value) any {
		js.Global().Get("URL").Call("revokeObjectURL", u)
		cb.Release()
		return nil
	})
	js.Global().Call("setTimeout", cb, 1000)
}
func option(selectEl js.Value, label string, v any) {
	o := create("option", "", label)
	o.Set("value", fmt.Sprint(v))
	selectEl.Call("append", o)
}
func localGet(key string) (s string) {
	defer func() { recover() }()
	v := js.Global().Get("localStorage").Call("getItem", key)
	if exists(v) {
		return v.String()
	}
	return ""
}
func localSet(key, s string) (err error) {
	defer func() {
		if p := recover(); p != nil {
			err = fmt.Errorf("Local storage unavailable: %v", p)
		}
	}()
	js.Global().Get("localStorage").Call("setItem", key, s)
	return nil
}
func num(m map[string]any, key string, fallback float64) float64 {
	if v, ok := m[key]; ok {
		switch n := v.(type) {
		case float64:
			return n
		case int:
			return float64(n)
		case json.Number:
			x, e := n.Float64()
			if e == nil {
				return x
			}
		case string:
			x, e := strconv.ParseFloat(n, 64)
			if e == nil {
				return x
			}
		}
	}
	return fallback
}
func str(m map[string]any, key string, fallback string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return fallback
}
func obj(m map[string]any, key string) map[string]any {
	if v, ok := m[key].(map[string]any); ok && v != nil {
		return v
	}
	return map[string]any{}
}
func clone[T any](v T) T { b, _ := json.Marshal(v); var out T; _ = json.Unmarshal(b, &out); return out }
