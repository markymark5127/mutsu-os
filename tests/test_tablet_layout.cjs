const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const folder = process.argv[2];
const geometry = fs.readFileSync(path.join(folder,'tabletGeometry.js'),'utf8').replace(/export /g,'');
const {splitFrames, navigationAction, maximizeWindow, unmaximizeWindow, isWindowMaximized,
    slideOverFrame, dockDropZone, gripResize, sameSequence} =
    new Function(`${geometry}; return {splitFrames,navigationAction,maximizeWindow,unmaximizeWindow,
        isWindowMaximized,slideOverFrame,dockDropZone,gripResize,sameSequence};`)();
for (const area of [{x:100,y:24,width:1200,height:800}, {x:0,y:30,width:768,height:990}]) {
    for (const ratio of [0,0.3,0.5,0.7,1]) {
        const [left,right] = splitFrames(area,ratio);
        assert.equal(left.width+right.width+12,area.width);
        assert.equal(right.x+right.width,area.x+area.width);
        assert.equal(left.height,area.height);
        assert(left.width>area.width*0.28 && right.width>area.width*0.28);
    }
}
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
    constructor(props={}){super();Object.assign(this,props);this.visible=true;this.translation_x=0;}
    add_child(){} contains(source){return source===this;}
}
const GLibMock={PRIORITY_DEFAULT:0,SOURCE_REMOVE:false,idle_add:(_p,fn)=>fn(),
    timeout_add:(_p,_ms,fn)=>fn(),timeout_add_seconds:()=>1,source_remove(){}};
const loadSplit=()=>new Function('Clutter','GLib','Meta','Shell','St','Main','global','splitFrames',
    'maximizeWindow','unmaximizeWindow','isWindowMaximized','slideOverFrame','sameSequence',
    `${splitSource};return TabletSplitView;`)(Clutter,GLibMock,{},{},
    {Button,Label:class{},Widget:ChromeWidget},Main,globalMock,
    splitFrames,maximizeWindow,unmaximizeWindow,isWindowMaximized,slideOverFrame,sameSequence);
const Split=loadSplit();
function window(){return Object.assign(new Emitter(),{allows_resize:()=>true,get_monitor:()=>0,
    get_workspace:()=>({}),unmake_fullscreen(){},unmaximize(){this.maximized=false;},
    maximize(){this.maximized=true;},is_maximized(){return !!this.maximized;},is_skip_taskbar:()=>false,
    minimize(){this.minimized=true;},make_above(){this.above=true;},unmake_above(){this.above=false;},
    move_to_monitor(){},change_workspace(){},unminimize(){this.minimized=false;},
    move_resize_frame(_user,x,y,width,height){this.frame={x,y,width,height};},
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
assert.equal(left.frame.width+right.frame.width+12,768, 'rotation reflows split');
keyboard.visible=true;keyboard.height=300;
keyboard.emit('notify::visible');keyboard.emit('visibility-changed');
assert.equal(left.frame.height,700, 'split avoids on-screen keyboard');
assert.equal(split._divider.visible,false);
keyboard.visible=false;keyboard.emit('notify::visible');keyboard.emit('visibility-changed');keyboard.emit('visibility-changed');
assert.equal(left.frame.height,1000);
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

// Slide Over: a stack, independent of Split View (three apps on screen).
const chrome=[];
Main.layoutManager.addChrome=actor=>chrome.push(actor);
Main.layoutManager.removeChrome=actor=>chrome.splice(chrome.indexOf(actor),1);
area={x:0,y:24,width:1280,height:776};
const multi=new (loadSplit())(()=>({x:0,y:0,width:1280,height:800}));
const a=window(),b=window(),c=window(),d=window();
multi.arrange(a,b);
assert.equal(multi.slideOver(c),true);
assert.deepEqual(multi.pair,[a,b],'Slide Over keeps the split pair: three apps at once');
assert.equal(c.above,true,'Slide Over floats above the split');
const frame=slideOverFrame({x:0,y:0,width:1280,height:800});
assert.deepEqual(c.frame,frame,'phone-width at the right edge');
const handle=multi._handle;
assert(handle.visible && handle.y+28<=frame.y,'handle sits above the app, not over it');
multi.slideOver(d);
assert.deepEqual(multi.slides,[d,c],'stack, newest on top');
assert.equal(c.minimized,true,'others in the stack wait off screen');
const drag=(actor,from,to)=>{
    const ev=(type,x)=>({type:()=>type,get_coords:()=>[x,0],get_source:()=>actor,
        get_event_sequence:()=>1,get_button:()=>1});
    globalMock.stage.emit('captured-event',ev(Clutter.EventType.TOUCH_BEGIN,from));
    globalMock.stage.emit('captured-event',ev(Clutter.EventType.TOUCH_UPDATE,(from+to)/2));
    globalMock.stage.emit('captured-event',ev(Clutter.EventType.TOUCH_END,to));
};
// Each handler connected on global.stage receives the events.
drag(handle,500,380);
assert.deepEqual(multi.slides,[c,d],'drag the handle left: next app in the stack');
assert.equal(c.minimized,false);assert.equal(d.minimized,true);
drag(handle,500,620);
assert.equal(c.minimized,true,'drag right: tuck the stack away');
assert.equal(multi._tab.visible,true,'edge tab appears');
assert.equal(handle.visible,false);
drag(multi._tab,1270,1200);
assert.equal(c.minimized,false,'drag the tab left: Slide Over is back');
assert.equal(multi._tab.visible,false);
c.emit('unmanaged');
assert.deepEqual(multi.slides,[d],'closing a Slide Over app removes it from the stack');
assert.equal(d.minimized,false,'and shows the next one');
multi.arrange(d,a);
assert.deepEqual(multi.slides,[],'moving a Slide Over app into Split View takes it out of the stack');
assert.equal(d.above,false);
multi.destroy();
assert.equal(chrome.length,0,'divider, handle and tab removed');
console.log('Multitasking checks passed (split + slide over together, stack, next, tuck away, edge tab, close, move to split).');

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
