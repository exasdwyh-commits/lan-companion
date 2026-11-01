const test=require('node:test'),assert=require('node:assert/strict');
const {eligible,match,follow,choose}=require('../MALFOY-ENGINE/web/live2d/window-perch');
const g={width:1200,height:800,charHeight:180,seated:true};
const a={app:'Editor',pid:7,x:100,y:300,w:600,h:400};
test('only a visible top edge with headroom is a seating target',()=>{assert.equal(eligible(a,g),true);assert.equal(eligible({...a,y:24},g),false);assert.equal(eligible({...a,y:810},g),false);assert.equal(eligible({...a,x:1400},g),false);assert.equal(choose([{...a,y:24},a],g,300),a);});
test('moving more than 60px keeps the same single application window',()=>{const moved={...a,x:450,y:360};assert.equal(match(a,[moved]),moved);assert.deepEqual(follow(a,moved,400,g),{x:750,y:360});});
test('a resize clamps the seat inside the remaining edge',()=>{const resized={...a,w:260};const p=follow(a,resized,650,g);assert.ok(p.x<360&&p.x>100);assert.equal(p.y,300);});
test('window IDs prevent swapping to a sibling after close',()=>{const first={...a,id:1},second={...a,id:2};assert.equal(match(first,[second]),null);assert.equal(match(a,[]),null);});
test('legacy host geometry matches the nearest sibling, with conservative ambiguous fallback',()=>{const second={...a,x:800};assert.equal(match(a,[second,{...a,x:125}]).x,125);assert.equal(match(a,[{...a,x:500},{...a,x:800}]),null);});
