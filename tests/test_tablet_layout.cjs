const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const folder = process.argv[2];
const geometry = fs.readFileSync(path.join(folder,'tabletGeometry.js'),'utf8').replace(/export /g,'');
const {splitFrames, splitVertical, navigationAction, maximizeWindow, unmaximizeWindow, isWindowMaximized,
    slideOverFrame, dockDropZone, gripResize, sameSequence, slideOverRelease, dragVelocity, slideOverhang,
    dropForeignEffects} =
    new Function(`${geometry}; return {splitFrames,splitVertical,navigationAction,maximizeWindow,unmaximizeWindow,
        isWindowMaximized,slideOverFrame,dockDropZone,gripResize,sameSequence,slideOverRelease,dragVelocity,
        slideOverhang,dropForeignEffects};`)();
for (const area of [{x:100,y:24,width:1200,height:800}, {x:0,y:30,width:1366,height:738}]) {
    for (const ratio of [0,0.3,0.5,0.7,1]) {
        const [left,right] = splitFrames(area,ratio);
        assert.equal(left.width+right.width+12,area.width);
        assert.equal(right.x+right.width,area.x+area.width);
        assert.equal(left.height,area.height);
        assert(left.width>area.width*0.28 && right.width>area.width*0.28);
    }
}
// Portrait (9:16): stacked top/bottom, full width, no overlap.
for (const area of [{x:0,y:30,width:768,height:990}, {x:0,y:32,width:720,height:1248}]) {
    assert.equal(splitVertical(area), true);
    for (const ratio of [0,0.3,0.5,0.7,1]) {
        const [top,bottom] = splitFrames(area,ratio);
        assert.equal(top.width,area.width); assert.equal(bottom.width,area.width);
        assert.equal(top.x,area.x); assert.equal(bottom.x,area.x);
        assert.equal(top.height+bottom.height+12,area.height);
        assert.equal(bottom.y,top.y+top.height+12);
        assert.equal(bottom.y+bottom.height,area.y+area.height);
        assert(top.height>area.height*0.28 && bottom.height>area.height*0.28);
    }
}
assert.equal(splitVertical({x:0,y:0,width:1280,height:800}), false);
assert.equal(navigationAction(0,-50,100,0,768),'dock');
assert.equal(navigationAction(0,-140,150,0,768),'home');
assert.equal(navigationAction(0,-140,650,200,768),'switcher');
assert.equal(navigationAction(-130,-10,100,0,768),'next');
assert.equal(navigationAction(130,-10,100,0,768),'previous');
assert.equal(navigationAction(20,10,100,0,768),'cancel');
const calls=[];
const fakeWindow={maximize(...args){calls.push(args)},unmaximize(...args){calls.push(args)}};
maximizeWindow(fakeWindow,{MaximizeFlags:{BOTH:3}});
unmaximizeWindow(fakeWindow,{});
assert.deepEqual(calls,[[3],[]], 'handle pre-49 and 49+ Mutter APIs');

class Emitter {
    constructor(){this.signals=new Map();this.next=0;}
    connect(name,fn){this.signals.set(++this.next,[name,fn]);return this.next;}
    disconnect(id){this.signals.delete(id);}
    emit(name,...args){for(const [signal,fn] of [...this.signals.values()])if(signal===name)fn(this,...args);}
}
class Button extends Emitter {
    constructor(){super();this.visible=true;}
    hide(){this.visible=false;}
    set_position(x,y){this.x=x;this.y=y;}
    set_size(width,height){this.width=width;this.height=height;}
    contains(source){return source==='divider';}
    destroy(){this.destroyed=true;}
}
const globalMock={stage:new Emitter(),display:new Emitter(),get_current_time:()=>0};
let area={x:0,y:24,width:1200,height:800};
const keyboard=Object.assign(new Emitter(),{visible:false,height:0});
const Main={overview:Object.assign(new Emitter(),{visible:false,hide(){this.visible=false;}}),
    sessionMode:Object.assign(new Emitter(),{isLocked:false}),
    layoutManager:Object.assign(new Emitter(),{monitors:[{}],primaryIndex:0,keyboardBox:keyboard,
        addChrome(){},removeChrome(){},getWorkAreaForMonitor:()=>area}),
    keyboard,activateWindow(window){globalMock.display.focus_window=window;},notify(){}};
const Clutter={BinLayout:class{},ActorAlign:{CENTER:0},EventType:{TOUCH_BEGIN:1,TOUCH_UPDATE:2,TOUCH_END:3,
    TOUCH_CANCEL:4,BUTTON_PRESS:5,BUTTON_RELEASE:6,MOTION:7},EVENT_STOP:1,EVENT_PROPAGATE:0};
const splitSource=fs.readFileSync(path.join(folder,'tabletSplitView.js'),'utf8')
    .replace(/^import [\s\S]*?;\r?\n/gm,'').replace(/^export /gm,'');
class ChromeWidget extends Button {
    constructor(props={}){super();Object.assign(this,props);this.visible=true;this.translation_x=0;this.classes=new Set();}
    add_child(){} contains(source){return source===this;}
    add_style_class_name(c){this.classes.add(c);} remove_style_class_name(c){this.classes.delete(c);}
}
const GLibMock={PRIORITY_DEFAULT:0,SOURCE_REMOVE:false,idle_add:(_p,fn)=>fn(),
    timeout_add:(_p,_ms,fn)=>fn(),timeout_add_seconds:()=>1,source_remove(){}};
const loadSplit=()=>new Function('Clutter','GLib','Meta','Shell','St','Main','global','slideOverhang','splitFrames','splitVertical',
    'maximizeWindow','unmaximizeWindow','isWindowMaximized','slideOverFrame','sameSequence',
    'slideOverRelease','dragVelocity','dropForeignEffects',
    `${splitSource};return TabletSplitView;`)(Clutter,GLibMock,{},{},
    {Button,Label:class{constructor(p={}){Object.assign(this,p);}},Widget:ChromeWidget},Main,globalMock,
    slideOverhang,splitFrames,splitVertical,maximizeWindow,unmaximizeWindow,isWindowMaximized,slideOverFrame,sameSequence,
    slideOverRelease,dragVelocity,dropForeignEffects);
const Split=loadSplit();
function window(){return Object.assign(new Emitter(),{allows_resize:()=>true,get_monitor:()=>0,
    get_workspace:()=>({}),unmake_fullscreen(){},unmaximize(){this.maximized=false;},
    maximize(){this.maximized=true;},is_maximized(){return !!this.maximized;},is_skip_taskbar:()=>false,
    minimize(){this.minimized=true;},make_above(){this.above=true;},unmake_above(){this.above=false;},
    move_to_monitor(){},change_workspace(){},unminimize(){this.minimized=false;},
    move_resize_frame(_user,x,y,width,height){this.frame={x,y,width,height};},
    move_frame(_user,x,y){this.frame={...this.frame,x,y};this.emit('position-changed');},
    get_frame_rect(){return {...(this.frame??{x:0,y:0,width:100,height:100})};},
    get_compositor_private:()=>null,
    get_transient_for:()=>null});}
const split=new Split(),left=window(),right=window();
split.arrange(left,right);
assert.equal(left.frame.width,594);
assert.equal(right.frame.x,606);
assert.equal(split._divider.visible,true);
split._ratio=0.65;
split._layout();
assert(left.frame.width>right.frame.width);
area={x:0,y:24,width:768,height:1000};
Main.layoutManager.emit('monitors-changed');
assert.equal(left.frame.width,768, 'portrait stacks the split: full width');
assert.equal(left.frame.height+right.frame.height+12,1000, 'rotation reflows split top/bottom');
assert(right.frame.y>left.frame.y);
assert(split._divider.width>split._divider.height, 'divider lies flat in portrait');
assert.equal(split._dividerLabel.text,'⋯');
keyboard.visible=true;keyboard.height=300;
keyboard.emit('notify::visible');keyboard.emit('visibility-changed');
assert.equal(left.frame.width,768, 'keyboard does not flip a portrait split');
assert.equal(right.frame.y+right.frame.height,24+700, 'split avoids on-screen keyboard');
assert.equal(split._divider.visible,false);
keyboard.visible=false;keyboard.emit('notify::visible');keyboard.emit('visibility-changed');keyboard.emit('visibility-changed');
assert.equal(left.frame.height+right.frame.height+12,1000, 'keyboard closes: split refills the screen');
Main.sessionMode.isLocked=true;Main.sessionMode.emit('updated');
assert.equal(split._divider.visible,false);
Main.sessionMode.isLocked=false;Main.sessionMode.emit('updated');
left.emit('unmanaged');
assert.equal(right.maximized,true, 'closing one app expands the survivor');
assert.equal(split._pair,null);
split.arrange(window(),window());
split.destroy();
assert.equal(globalMock.stage.signals.size,0);
assert.equal(keyboard.signals.size,0);
assert.equal(Main.sessionMode.signals.size,0);
console.log('Tablet layout checks passed (gesture choices, portrait, divider ratios, keyboard, lock, close, teardown).');

const switcherSource=fs.readFileSync(path.join(folder,'tabletSwitcher.js'),'utf8')
    .replace(/^import [\s\S]*?;\r?\n/gm,'').replace('export ','');
const Switcher=new Function('Main','Meta','global',`${switcherSource};return TabletSwitcher;`)(
    Main,{TabList:{NORMAL_ALL:0},WindowType:{NORMAL:0}},globalMock);
const first={is_skip_taskbar:()=>false,get_window_type:()=>0};
const second={...first},third={...first};
globalMock.display.get_tab_list=()=>[globalMock.display.focus_window,
    ...[first,second,third].filter(w=>w!==globalMock.display.focus_window)];
globalMock.display.focus_window=first;
const navigation=Object.create(Switcher.prototype);
navigation._quickSwitch(1);
assert.equal(globalMock.display.focus_window,second);
navigation._quickSwitch(1);
assert.equal(globalMock.display.focus_window,third, 'consecutive swipes advance beyond two apps');
navigation._quickSwitch(-1);
assert.equal(globalMock.display.focus_window,second);
console.log('Recent-app navigation ring checks passed.');

class Box extends Button {
    constructor(){super();this.children=[];this.classes=new Set();}
    add_child(child){this.children.push(child);}
    add_style_class_name(c){this.classes.add(c);}
    remove_style_class_name(c){this.classes.delete(c);}
}
const quickActor=new Box(),dateActor=new Box();
Main.panel={statusArea:{quickSettings:{menu:{actor:quickActor}},dateMenu:{menu:{actor:dateActor}}}};
const preferences=Object.assign(new Emitter(),{values:{'automatic-keyboard':true},
    get_boolean(key){return this.values[key];}});
const journalCalls=[];
const journal={change(schema,key,apply){journalCalls.push(['change',schema,key]);
        apply({set_boolean:(k,v)=>journalCalls.push(['set',k,v])});return true;},
    revert(schema,key){journalCalls.push(['revert',schema,key]);}};
let keyboardDestroyed=false;
const sessionSource=fs.readFileSync(path.join(folder,'tabletSession.js'),'utf8')
    .replace(/^import [\s\S]*?;\r?\n/gm,'').replace(/^export /gm,'');
const Session=new Function('Main','TabletKeyboard',`${sessionSource};return TabletSession;`)(
    Main,class {destroy(){keyboardDestroyed=true;}});
const session=new Session(preferences,journal);
assert.deepEqual(journalCalls,[],
    'the on-screen keyboard is left to GNOME: shown after touch, hidden when a hardware keyboard is used');
assert(quickActor.classes.has('mutsu-tablet-controls'),'larger touch targets in Controls');
session.destroy();
assert.equal(keyboardDestroyed,true);
assert.equal(quickActor.classes.has('mutsu-tablet-controls'),false);
console.log('Tablet session checks passed (native automatic keyboard, controls, cleanup).');

// Slide Over: up to two apps on one row, independent of Split View.
const chrome=[];
Main.layoutManager.addChrome=actor=>chrome.push(actor);
Main.layoutManager.removeChrome=actor=>chrome.splice(chrome.indexOf(actor),1);
area={x:0,y:24,width:1280,height:776};
const multi=new (loadSplit())(()=>({x:0,y:0,width:1280,height:800}));
const a=window(),b=window(),c=window(),d=window(),e3=window();
multi.arrange(a,b);
assert.equal(multi.slideOver(c),true);
assert.deepEqual(multi.pair,[a,b],'Slide Over keeps the split pair');
assert.equal(c.above,true,'Slide Over floats above the split');
const frame=slideOverFrame({x:0,y:0,width:1280,height:800});
assert.deepEqual(c.frame,frame,'phone-width at the right edge');
const handleC=multi._handle;
assert(handleC.visible && handleC.y+28<=frame.y,'handle sits above the app, not over it');
// Always on top: another app coming forward goes under Slide Over.
let raised=0;c.raise=()=>raised++;
globalMock.display.focus_window=a;globalMock.display.emit('notify::focus-window');
assert.equal(raised,1,'Slide Over raised over the app that came forward');
// A second one opens at the free (left) end; both on screen, one row.
multi.slideOver(d);
assert.deepEqual(multi.slides,[d,c]);
assert.equal(!!c.minimized,false,'the first stays on screen');
assert.equal(d.frame.x,12,'second opens at the left end of the row');
assert.equal(d.frame.y,c.frame.y,'same row');
const handleD=multi._handle;
assert.notEqual(handleD,handleC,'each has its own handle');
let now=1000;
Date.now=()=>now;
const drag=(actor,from,to,ms=400)=>{
    const ev=(type,x)=>({type:()=>type,get_coords:()=>[x,0],get_source:()=>actor,
        get_event_sequence:()=>1,get_button:()=>1});
    globalMock.stage.emit('captured-event',ev(Clutter.EventType.TOUCH_BEGIN,from));
    now+=ms/2;
    globalMock.stage.emit('captured-event',ev(Clutter.EventType.TOUCH_UPDATE,(from+to)/2));
    now+=ms/2;
    globalMock.stage.emit('captured-event',ev(Clutter.EventType.TOUCH_END,to));
    now+=1000;
};
// They bump into each other instead of overlapping.
drag(handleD,200,1200,4000);
assert.equal(d.frame.x,c.frame.x-d.frame.width-12,'dragging into the other stops at it');
assert.equal(d.frame.y,frame.y,'...sideways only');
assert.equal(d.frame.width,frame.width,'...at a fixed size');
drag(handleD,600,300,800);
const dX=d.frame.x;
assert(dX<c.frame.x-d.frame.width-12,'a slow drag back just moves it');
assert.equal(handleD.x,d.frame.x+Math.round(d.frame.width/2)-60,'the handle stays above the app');
// Flick right: tucks off the right edge, with the arrow on the right.
drag(handleC,800,1200,80);
assert.equal(c.minimized,true,'flick right: tucked away to the right');
assert.equal(multi.tuckedOn('right'),c);
assert.equal(multi.tabs.right.visible,true,'arrow tab on the right edge');
assert.equal(multi.tabs.right.x,1280-26);
assert.equal(multi.tabs.left.visible,false);
assert.equal(handleC.visible,false);
// The second one flicked right too: the right edge is taken, so it goes
// off the left edge instead, with its arrow on the left.
drag(handleD,dX+100,dX+600,80);
assert.equal(d.minimized,true);
assert.equal(multi.tuckedOn('left'),d,'right edge taken: tucked to the left');
assert.equal(multi.tabs.left.visible,true);
assert.equal(multi.tabs.left.x,0);
// Each arrow brings back its own app, from its own edge.
drag(multi.tabs.right,1270,1270,40);
assert.equal(c.minimized,false,'right arrow: that app slides back');
assert.equal(c.frame.x,frame.x,'...in at the right end');
assert.equal(multi.tabs.right.visible,false);
assert.equal(multi.tabs.left.visible,true,'the other stays tucked on the left');
drag(multi.tabs.left,5,80,300);
assert.equal(d.minimized,false,'drag the left arrow inward: back again');
assert.equal(d.frame.x,12,'...at the left end');
assert(d.frame.x+d.frame.width+12<=c.frame.x,'both on screen, not overlapping');
// A third app replaces the oldest, which becomes an ordinary app again.
multi.slideOver(e3);
assert.equal(multi.slides.length,2,'two at most');
assert(!multi.slides.includes(c),'the oldest left Slide Over');
assert.equal(c.minimized,true);assert.equal(c.above,false);
assert.equal(handleC.destroyed,true);
// Title-bar drag (Mutter's move): handle follows; on release it returns to
// its row at its size, and can't end up over the other app.
const he=multi._handle;
globalMock.display.emit('grab-op-begin',e3);
e3.frame={...e3.frame,x:e3.frame.x-40,y:300};e3.emit('position-changed');
assert.equal(he.x,e3.frame.x+Math.round(e3.frame.width/2)-60,'handle follows a title-bar drag');
now+=500;
globalMock.display.emit('grab-op-end',e3);
assert.equal(e3.frame.y,frame.y,'...and it snaps back to its row');
const [l,r]=[d,e3].sort((p,q)=>p.frame.x-q.frame.x);
assert(l.frame.x+l.frame.width+12<=r.frame.x,'still not overlapping');
// Pull the handle down: the app leaves Slide Over as the full-screen app.
const pull=(actor,dy,dx=0)=>{
    const ev=(type,x,y)=>({type:()=>type,get_coords:()=>[x,y],get_source:()=>actor,
        get_event_sequence:()=>1,get_button:()=>1});
    globalMock.stage.emit('captured-event',ev(Clutter.EventType.TOUCH_BEGIN,500,0));
    now+=150;
    globalMock.stage.emit('captured-event',ev(Clutter.EventType.TOUCH_UPDATE,500+dx/2,dy/2));
    now+=150;
    globalMock.stage.emit('captured-event',ev(Clutter.EventType.TOUCH_END,500+dx,dy));
    now+=1000;
};
const hd=multi._entries.find(o=>o.window===d).handle;
const dBefore={...d.frame};
pull(hd,40);
assert.deepEqual(multi.slides.includes(d),true,'a short pull down settles back into Slide Over');
assert.deepEqual(d.frame,dBefore,'...where it was');
assert.equal(hd.translation_y,0,'...and the handle is back in place');
pull(hd,200,30);
assert.equal(multi.slides.includes(d),false,'pulled down: it leaves Slide Over');
assert.equal(d.maximized,true,'...as the full-screen app');
assert.equal(d.above,false,'...no longer floating above');
assert.equal(globalMock.display.focus_window,d,'...and in front');
assert.equal(hd.destroyed,true,'its handle is gone');
assert.equal(multi.slides.includes(e3),true,'the other Slide Over app stays');
// From multitasking (a tucked one too): leaveSlideOver brings it back full screen.
multi.slideOver(d);
multi.hideSlide(d,'left');
assert.equal(d.minimized,true);
assert.equal(multi.leaveSlideOver(d),true);
assert.equal(d.minimized,false,'a tucked app comes back');
assert.equal(d.maximized,true,'...full screen');
assert.equal(multi.tabs.left.visible,false,'its arrow tab goes away');
assert.equal(multi.leaveSlideOver(d),false,'not in Slide Over: nothing to do');
multi.slideOver(d);
e3.emit('unmanaged');
assert.deepEqual(multi.slides,[d],'closing a Slide Over app removes it');
multi.arrange(d,a);
assert.deepEqual(multi.slides,[],'moving a Slide Over app into Split View takes it out');
assert.equal(d.above,false);
// From a minimized app (multitasking) it still arrives as Slide Over.
const m1=window();m1.minimized=true;
multi.slideOver(m1);
assert.equal(m1.minimized,false);assert.deepEqual(m1.frame,frame);
// Leaving tablet mode: Slide Over apps fold away and become ordinary apps.
multi.leaveTablet();
assert.equal(m1.minimized,true,'Slide Over app put away when tablet mode ends');
assert.equal(m1.above,false);
assert.deepEqual(multi.slides,[]);
multi.destroy();
assert.equal(chrome.length,0,'divider, handles and tabs removed');
assert.equal(slideOverRelease(200,2),'tuck-right');
// Dragged off a side (even slowly) tucks it to that side; that's the rule
// that decides, not a guess from speed alone.
assert.equal(slideOverRelease(-150,0,-0.4),'tuck-left');
assert.equal(slideOverRelease(150,0,0.4),'tuck-right');
assert.equal(slideOverRelease(150,0,0.1),'move');
assert.equal(slideOverRelease(-150,-2,0),'tuck-left','flick left');
assert.equal(slideOverRelease(0,0,0,120),'fullscreen','pulled straight down');
assert.equal(slideOverRelease(20,0,0,60),'move','not far enough down');
assert.equal(slideOverRelease(200,0,0,100),'move','mostly sideways is a move, not a pull down');
assert.equal(slideOverRelease(40,-2,0),'move','flick against the drag is not a tuck');
const mon={x:0,y:0,width:1280,height:800};
assert.equal(slideOverhang(-150,375,mon),-0.4);
assert.equal(slideOverhang(1280-375+150,375,mon),0.4);
assert.equal(slideOverhang(400,375,mon),0);
assert.equal(slideOverRelease(-200,-2),'tuck-left');
assert.equal(slideOverRelease(200,0.2),'move');
assert.equal(slideOverRelease(3,0),'tap');
assert.equal(dragVelocity([[0,0],[50,50],[100,100]]),1);
console.log('Multitasking checks passed (split + two Slide Over apps, always on top, bump not overlap, one tucked app per edge, arrow per edge, third replaces oldest, title-bar drag, close, move to split).');

// Dock drag targets and floating-window resize.
const screen={x:0,y:0,width:1280,height:800};
assert.equal(dockDropZone(40,300,screen,690),'split-left');
assert.equal(dockDropZone(1250,300,screen,690),'split-right');
assert.equal(dockDropZone(640,300,screen,690),'slide');
assert.equal(dockDropZone(640,700,screen,690),null,'back over the dock cancels');
assert.deepEqual(gripResize({x:100,y:100,width:600,height:400},50,-300,screen),
    {x:100,y:100,width:650,height:240},'minimum size kept');
assert.deepEqual(gripResize({x:100,y:100,width:600,height:400},2000,2000,screen),
    {x:100,y:100,width:1180,height:700},'stays on screen');
console.log('Dock drop zones and resize grip checks passed.');

// Bazzite's magic lamp extension puts its own (un)minimize warp on the
// window; Slide Over's slide (a clone, which draws the window's effects)
// showed the warp coming from the dock instead of the slide from the edge.
{
    const finished=[];
    const effect=name=>({get_name:()=>name,destroy(){finished.push(name);}});
    const blur={get_name:()=>'blur',destroy(){finished.push('blur');}};
    const plain={get_name:()=>'unminimize-other'}; // can't finish itself: left alone
    const actor={get_effects:()=>[effect('unminimize-magic-lamp-effect'),blur,plain,effect('minimize-magic-lamp-effect')]};
    assert.equal(dropForeignEffects(actor),2,'both lamp effects finished');
    assert.deepEqual(finished,['unminimize-magic-lamp-effect','minimize-magic-lamp-effect'],'other effects untouched');
    assert.equal(dropForeignEffects(null),0);
    assert.equal(dropForeignEffects({get_effects:()=>[]}),0);
}
{
    const src=fs.readFileSync(path.join(folder,'tabletSplitView.js'),'utf8');
    assert(/connect_after/.test(src)&&/dropForeignEffects\(actor\)/.test(src),
        'Slide Over finishes other extensions\' (un)minimize effects on its windows');
    const leave=src.slice(src.indexOf('leaveTablet() {'),src.indexOf('_show(e, fromSide) {'));
    assert(!/remove_all_transitions/.test(leave),'leaving tablet mode only stops Slide Over\'s own animations');
}
console.log('Slide Over vs. other minimize effects checks passed.');
