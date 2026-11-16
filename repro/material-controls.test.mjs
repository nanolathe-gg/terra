import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tablePlacementRows,coverRows,COVER_ROWS} from '../sculpt-material-model.js';
const table=JSON.parse(fs.readFileSync(new URL('../materials/green.json',import.meta.url)));
test('the placement rows are the table\'s own: where rock shows off the rock face, six rows',()=>{
 const q=table.placement,rows=tablePlacementRows(table);
 assert.equal(rows.length,6);
 assert.deepEqual(rows[0],[q.rock.slope,q.rock.formSlope,q.rock.convexity,q.rock.convexityRange]);
 assert.deepEqual(rows[5],[q.route.from,q.route.to,0,0]);
 assert.equal(q.face,undefined,'the face blend went with the rock face: the table has no face rows');
});

test('the rows after the placement rows hold the world\'s site and its plants: none without them',()=>{
 assert.deepEqual(coverRows(),Array.from({length:COVER_ROWS},()=>[0,0,0,0]));
 const site=JSON.parse(fs.readFileSync(new URL('../materials/defaults.json',import.meta.url))).site,rows=coverRows(site);
 assert.deepEqual(rows[0],[0,site.wet[0],site.wet[1],site.dry]);
 assert.deepEqual(rows[1],[site.soil.slope[0],site.soil.slope[1],site.soil.convex,site.soil.deposit]);
 assert.deepEqual(rows[2],[0,site.moisture.perSwath,site.moisture.swathRef,site.moisture.shade]);
});
