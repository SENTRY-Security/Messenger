#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),runtime=require('./runtime.cjs');
const {createViewerBundle,initAuditHost}=require('./viewer-bundle.cjs');
(async()=>{
 const out=path.join(runtime.outputDir,'transition-cancel-results');fs.mkdirSync(out,{recursive:true});
 const bundle=await createViewerBundle(path.join(runtime.viewerDir,'pptx-playback.js'),'window.transitionCancelAudit={createPptxPlayback,createPptxAudioBus};');
 const browser=await runtime.playwright().chromium.launch(runtime.launchOptions()),page=await browser.newPage({viewport:{width:960,height:540}}),exceptions=[];page.on('pageerror',e=>exceptions.push(e.message));
 try{
  await initAuditHost(page);await page.setContent('<main id="slide" style="position:relative;width:960px;height:540px;background:red"></main>');await page.addScriptTag({content:bundle.content});
  const cases=await page.evaluate(async()=>{
   const api=window.transitionCancelAudit,root=document.getElementById('slide'),cases=[],wait=ms=>new Promise(r=>setTimeout(r,ms));
   const assert=(ok,message)=>{if(!ok)throw Error(message);},test=async(name,fn)=>{try{cases.push({name,status:'MATCH',matchesTrait:true,evidence:await fn()});}catch(e){cases.push({name,status:'MISMATCH',matchesTrait:false,error:e.message});}};
   const base=()=>({timeline:[],media:[],failures:[],transition:{kind:'fade',duration:5000}});
   for(const action of ['cancel','dispose'])await test(`${action} while genuine audio bus resolver waits cannot launch a late native transition`,async()=>{
    let release,cleaned=0,animateCalls=0;const originalStyle=root.getAttribute('style'),nativeAnimate=root.animate.bind(root);
    root.animate=(...args)=>{animateCalls++;return nativeAnimate(...args);};
    const bus=api.createPptxAudioBus(),model=base();model.transition.sound={action:'start',relationshipId:'sound1',source:{target:'ppt/media/late.wav'},loop:false};
    const controller=api.createPptxPlayback({model,root,audioBus:bus,resolveMedia:()=>new Promise(resolve=>release=resolve)});
    const pending=controller.transition();
    try{
     assert(typeof release==='function','Precondition: real transition sound resolver did not start');
     assert(root.getAnimations().length===0&&animateCalls===0,'Native transition started before sound readiness');
     controller[action]();bus.stop();release({url:'data:audio/wav;base64,',cleanup:()=>cleaned++});
     await wait(40);
     assert(cleaned===1,'Cancelled real audio bus did not release late resource');
     assert(animateCalls===0&&root.getAnimations().length===0,'Cancelled transition launched late native WAAPI after sound resolution');
     assert(root.getAttribute('style')===originalStyle,'Cancelled transition changed original root style');
     return {animateCalls,activeAnimations:root.getAnimations().length,resourceCleanupCount:cleaned,originalStyleExact:true};
    }finally{controller.dispose();bus.dispose();await pending;root.animate=nativeAnimate;root.setAttribute('style',originalStyle);}
   });
   await test('positive control real fade calls native WAAPI once and releases animation',async()=>{
    let calls=0;const nativeAnimate=root.animate.bind(root);root.animate=(...args)=>{calls++;return nativeAnimate(...args);};
    const model=base();model.transition.duration=30;const controller=api.createPptxPlayback({model,root});
    try{const pending=controller.transition();assert(root.getAnimations().length===1,'Positive control produced no native animation');await pending;assert(calls===1&&root.getAnimations().length===0,'Positive fade did not finish once');return {nativeAnimateCalls:calls,finishedAnimations:0};}
    finally{controller.dispose();root.animate=nativeAnimate;}
   });return cases;
  });
  const changedDependencies=bundle.changedDependencies(),failed=cases.length!==3||cases.some(c=>c.status!=='MATCH')||exceptions.length||changedDependencies.length;
  const report={cases,exceptions,sourceSha256:bundle.sourceSha256,dependencyHashes:bundle.dependencyHashes,changedDependencies,operationalStatus:failed?'fail':'pass',acceptanceStatus:'unverified',scope:'Real native WAAPI and real presentation audio-bus cancellation lifecycle; no Microsoft timing/media pixel equivalence claim'};
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exitCode=failed?1:3;
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=2;});
