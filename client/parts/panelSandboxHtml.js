    function panelSandboxHtml(token, source, settings, draft) {
      const safe = (v) => JSON.stringify(v).replace(/</g, '\\u003c')
      const shim = [
        'const TOKEN=' + safe(token) + ';',
        'const SOURCE=' + safe(source) + ';',
        'const SETTINGS=' + safe(settings) + ';',
        'const DRAFT=' + safe(draft) + ';',
        "const root=document.getElementById('root');",
        'let seq=0,current=SETTINGS,draft=DRAFT,hooks=[],hookPos=0,effects=[],pending=new Map();',
        "function post(type,payload){parent.postMessage({token:TOKEN,type:type,payload:payload},'*')}",
        "function rpc(type,payload){return new Promise(function(resolve){var id=++seq;pending.set(String(id),resolve);post('rpc',{id:id,type:type,payload:payload})})}",
        "window.addEventListener('message',function(e){var d=e.data;if(!d||d.token!==TOKEN||d.type!=='rpc-result')return;var f=pending.get(String(d.id));if(f){pending.delete(String(d.id));f(d.result)}});",
        "function call(path,body){return rpc('call',{path:path,body:body})}",
        "function save(patch){return rpc('save',{patch:patch})}",
        "function toast(text,kind){post('toast',{text:text,kind:kind})}",
        "function reload(){post('reload')}",
        "function setSettings(patch){draft=Object.assign({},draft,patch||{});post('draft',{patch:patch||{}});render()}",
        "function h(type,props){var children=[];for(var i=2;i<arguments.length;i++)children.push(arguments[i]);return{type:type,props:props||{},children:children}}",
        "function flatten(v,out){if(Array.isArray(v)){v.forEach(function(x){flatten(x,out)})}else if(v!==null&&v!==undefined&&v!==false&&v!==true){out.push(v)}return out}",
        "function mount(v,parent){if(v===null||v===undefined||v===false||v===true)return;if(Array.isArray(v)){v.forEach(function(x){mount(x,parent)});return}if(typeof v==='string'||typeof v==='number'){parent.appendChild(document.createTextNode(String(v)));return}if(typeof v.type==='function'){mount(v.type(Object.assign({},v.props,{children:flatten(v.children,[]).concat(flatten(v.props.children,[]))})),parent);return}var tag=v.type==='Fragment'?'div':String(v.type);var el=document.createElement(tag);var p=v.props||{};Object.keys(p).forEach(function(k){var val=p[k];if(k==='children'||val===null||val===undefined)return;if(k==='className'){el.className=val;return}if(k==='style'&&typeof val==='object'){Object.assign(el.style,val);return}if(k==='value'||k==='checked'||k==='selected'||k==='disabled'||k==='placeholder'||k==='type'||k==='title'){el[k]=val;return}if(k.slice(0,2)==='on'&&typeof val==='function'){var ev=k.slice(2).toLowerCase();el.addEventListener(ev,function(e){if(k==='onChange'&&(e.target.type==='checkbox'||e.target.type==='radio')){val(e.target.checked)}else{val(e)}});return}if(k==='html'){el.innerHTML=val;return}try{el.setAttribute(k,val)}catch(e){}});flatten(v.children,[]).concat(flatten(p.children,[])).forEach(function(c){mount(c,el)});parent.appendChild(el)}",
        "function useState(init){var i=hookPos++;if(!(i in hooks))hooks[i]=typeof init==='function'?init():init;return[hooks[i],function(v){hooks[i]=typeof v==='function'?v(hooks[i]):v;schedule()}]}",
        "function useEffect(fn,deps){var i=hookPos++;var prev=hooks[i];if(!prev||!deps||!prev.deps||deps.some(function(x,j){return x!==prev.deps[j]})){hooks[i]={deps:deps,fn:fn};effects.push(fn)}}",
        "function useMemo(fn,deps){var i=hookPos++;var prev=hooks[i];if(!prev||!deps||!prev.deps||deps.some(function(x,j){return x!==prev.deps[j]})){hooks[i]={deps:deps,value:fn()}}return hooks[i].value}",
        "function useRef(v){var i=hookPos++;if(!(i in hooks))hooks[i]={current:v};return hooks[i]}",
        "function useCallback(fn,deps){return useMemo(function(){return fn},deps)}",
        "function schedule(){if(schedule.pending)return;schedule.pending=true;setTimeout(function(){schedule.pending=false;render()},0)}",
        "function render(){hookPos=0;effects=[];root.innerHTML='';try{var node=C({settings:current,draftSettings:draft,setSettings:setSettings,save:save,toast:toast,reload:reload});mount(node,root);effects.forEach(function(fn){try{fn()}catch(e){console.error(e)}});post('height',{height:document.body.scrollHeight+20})}catch(e){root.textContent='面板出错了：'+String(e&&e.message||e);post('error',{message:String(e&&e.message||e)})}}",
        "var React={createElement:h,Fragment:'div',useState:useState,useEffect:useEffect,useMemo:useMemo,useRef:useRef,useCallback:useCallback};",
        "var ui={Card:function(p){return h('section',{className:'card'},p.title?h('h3',null,p.title):null,p.desc?h('p',{className:'muted'},p.desc):null,p.right?h('div',{className:'right'},p.right):null,p.children)},Btn:function(p){return h('button',{className:'btn '+(p.kind||'')+(p.small?' small':''),disabled:p.disabled,onClick:p.onClick},p.children)},Switch:function(p){return h('input',{type:'checkbox',checked:!!p.value,onChange:p.onChange})},Row:function(p){return h('div',{className:'row'},p.label?h('label',null,p.label):null,h('div',null,p.children))},Empty:function(p){return h('div',{className:'empty'},p.text||'暂无')},Select:function(p){return h('select',{value:p.value,onChange:function(e){p.onChange&&p.onChange(e.target.value)}}, (p.options||[]).map(function(o){var v=typeof o==='string'?o:o.value;var l=typeof o==='string'?o:o.label;return h('option',{value:v,key:v,selected:String(v)===String(p.value)},l)}))},Seg:function(p){return h('div',{className:'seg'},p.children)},Range:function(p){return h('input',{type:'range',min:p.min,max:p.max,step:p.step,value:p.value,onChange:function(e){p.onChange&&p.onChange(Number(e.target.value))}})}};",
        "var C;try{C=new Function('React','h','ui','call','save','toast','reload','settings','draftSettings','setSettings',SOURCE)(React,h,ui,call,save,toast,reload,current,draft,setSettings);if(typeof C!=='function')throw new Error('panel.js 最后要 return 一个组件（函数）')}catch(e){root.textContent='面板加载失败：'+String(e&&e.message||e);post('error',{message:String(e&&e.message||e)});throw e}",
        "render();post('ready',{});"
      ].join('\n')
      return '<!doctype html><html><head><meta charset="utf-8"><style>'
        + 'body{font:13px/1.5 system-ui,sans-serif;margin:0;padding:8px;color:#ddd;background:transparent}.card{border:1px solid #333;border-radius:8px;padding:10px;margin:8px 0}.muted{color:#999;font-size:12px}.btn{border:1px solid #444;background:#222;color:#eee;border-radius:6px;padding:4px 10px;cursor:pointer}.btn.primary{background:#3b6ea8}.btn.small{padding:2px 7px;font-size:12px}.row{display:flex;gap:8px;align-items:center;margin:6px 0}.row>label{min-width:90px;color:#aaa}.right{float:right}.empty{color:#888;padding:12px}.seg{display:flex;gap:4px}select,input{background:#1c1c1c;color:#eee;border:1px solid #444;border-radius:4px;padding:3px}'
        + '</style></head><body><div id="root"></div><script>' + shim + '</script></body></html>'
    }
