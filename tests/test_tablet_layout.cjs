const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const folder = process.argv[2];
const geometry = fs.readFileSync(path.join(folder,'tabletGeometry.js'),'utf8').replace(/export /g,'');
const {splitFrames, navigationAction, maximizeWindow, unmaximizeWindow} =
    new Function(`${geometry}; return {splitFrames,navigationAction,maximizeWindow,unmaximizeWindow};`)();
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
    activateWindow(window){globalMock.display.focus_window=window;},notify(){}};
const Clutter={ActorAlign:{CENTER:0},EventType:{TOUCH_BEGIN:1,TOUCH_UPDATE:2,TOUCH_END:3,
    TOUCH_CANCEL:4,BUTTON_PRESS:5,BUTTON_RELEASE:6,MOTION:7},EVENT_STOP:1,EVENT_PROPAGATE:0};
const splitSource=fs.readFileSync(path.join(folder,'tabletSplitView.js'),'utf8')
    .replace(/^import .*;\r?\n/gm,'').replace('export ','');
const Split=new Function('Clutter','Meta','St','Main','global','splitFrames','maximizeWindow','unmaximizeWindow',
    `${splitSource};return TabletSplitView;`)(Clutter,{}, {Button,Label:class{}},Main,globalMock,
    splitFrames,maximizeWindow,unmaximizeWindow);
function window(){return Object.assign(new Emitter(),{allows_resize:()=>true,get_monitor:()=>0,
    get_workspace:()=>({}),unmake_fullscreen(){},unmaximize(){},maximize(){this.maximized=true;},
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
keyboard.emit('notify::visible');
assert.equal(left.frame.height,700, 'split avoids on-screen keyboard');
assert.equal(split._divider.visible,false);
keyboard.visible=false;keyboard.emit('notify::visible');
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
    .replace(/^import .*;\r?\n/gm,'').replace('export ','');
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
    constructor(){super();this.children=[];}
    add_child(child){this.children.push(child);}
    set_width(width){this.width=width;}
    add_style_class_name(){}
    remove_style_class_name(){}
}
let keyboardOverride={value:false};
const originalOverride=keyboardOverride;
class Settings {
    get_user_value(){return keyboardOverride;}
    set_boolean(_key,value){keyboardOverride={value};}
    reset(){keyboardOverride=null;}
    set_value(_key,value){keyboardOverride=value;}
    get_string(){return '12h';}
}
const preferences=Object.assign(new Emitter(),{values:{'home-widgets':true,'automatic-keyboard':true},
    get_boolean(key){return this.values[key];}});
const quickActor=new Box(),dateActor=new Box();
Main.panel={statusArea:{quickSettings:{menu:{actor:quickActor}},dateMenu:{menu:{actor:dateActor}}}};
Main.overview._overview=new Box();
Main.layoutManager.primaryMonitor={x:0,y:0,width:768,height:1024};
const sessionSource=fs.readFileSync(path.join(folder,'tabletSession.js'),'utf8')
    .replace(/^import .*;\r?\n/gm,'').replace('export ','');
const Session=new Function('Clutter','Gio','GLib','St','Main',`${sessionSource};return TabletSession;`)(
    Clutter,{Settings},{DateTime:{new_now_local:()=>({format:()=> '10:00 AM\nThursday'})},
        PRIORITY_DEFAULT:0,SOURCE_CONTINUE:true,timeout_add_seconds:()=>1,source_remove(){}},
    {BoxLayout:Box,Label:Box,Button:Box},Main);
const session=new Session(()=>{},preferences);
assert.equal(keyboardOverride.value,true,'tablet enables native text-field keyboard');
Main.overview.visible=true;Main.overview.emit('showing');
assert.equal(session._strip.visible,true);
assert.equal(session._strip.vertical,true,'portrait widgets reflow');
preferences.values['home-widgets']=false;preferences.emit('changed::home-widgets');
assert.equal(session._strip.visible,false,'widgets can be disabled');
session.destroy();
assert.equal(keyboardOverride,originalOverride,'desktop restores exact keyboard preference');
assert.equal(preferences.signals.size,0);
console.log('Tablet session checks passed (keyboard preference, Home widgets, portrait, cleanup).');
