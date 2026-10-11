import {escapeHtml} from './markdown.js';
export const IMAGE_STYLES={natural:'As described',photo:'Realistic photo',illustration:'Illustration',watercolor:'Watercolor',poster:'Poster'};
export function safeChatImage(value) {
  return typeof value==='string' && value.length<=4_000_040 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
}
export function imageCard(image,index) {
  if(!safeChatImage(image?.url)) return '';
  const ext=image.url.startsWith('data:image/jpeg') ? 'jpg' : image.url.startsWith('data:image/webp') ? 'webp' : 'png';
  return `<figure class="chat-image"><button class="chat-image-open" type="button" data-preview-image="${index}" aria-label="Open generated image"><img src="${image.url}" alt="${escapeHtml(image.prompt || 'AI-generated image')}" loading="lazy"></button><figcaption>AI-generated · ${escapeHtml(image.size || '')}</figcaption><div class="lib-actions"><a class="setting-btn" href="${image.url}" download="grandpa-image-${index+1}.${ext}">Download image</a><button class="setting-btn" type="button" data-another-image="${index}">Create another</button><button class="setting-btn" type="button" data-copy-image-prompt="${index}">Copy description</button></div></figure>`;
}
export function mountImageComposer({onGenerate,enabled=()=>true}) {
  const dialog=document.createElement('dialog');
  dialog.className='image-composer';
  dialog.setAttribute('aria-label','Create an image');
  dialog.innerHTML=`<form class="image-form"><div class="image-heading"><h2>Create an image</h2><button type="button" data-image-close aria-label="Close image composer">✕</button></div>
    <p>Describe your idea. Include the subject, setting, colors and any exact words you want in the image.</p>
    <label for="image-prompt">Your image description</label><textarea id="image-prompt" name="prompt" maxlength="4000" rows="5" required placeholder="A beautiful Liberian classroom with students learning on laptops…"></textarea>
    <div class="image-options"><label>Style<select name="style">${Object.entries(IMAGE_STYLES).map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select></label>
    <label>Shape<select name="size"><option value="1024x1024">Square</option><option value="1536x1024">Landscape</option><option value="1024x1536">Portrait</option></select></label>
    <label>Quality<select name="quality"><option value="high">High detail</option><option value="medium">Balanced</option><option value="low">Quick draft</option></select></label></div>
    <p class="settings-note">Creates one image using the app’s API credits. High detail costs more. Generated images can contain mistakes; check important text and details.</p>
    <p data-image-status role="status" hidden></p><div class="lib-actions"><button class="lib-go" type="submit">Create image</button><button class="setting-btn" type="button" data-image-cancel hidden>Cancel generation</button></div></form>`;
  document.body.append(dialog);
  const form=dialog.querySelector('form'),status=dialog.querySelector('[data-image-status]'),submit=form.querySelector('[type="submit"]'),cancel=form.querySelector('[data-image-cancel]');
  let controller=null;
  const say=message=>{status.textContent=message;status.hidden=!message;};
  const close=()=>{controller?.abort();dialog.close();};
  dialog.querySelector('[data-image-close]').addEventListener('click',close);
  dialog.addEventListener('cancel',()=>controller?.abort());
  cancel.addEventListener('click',()=>controller?.abort());
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(controller) return;
    if(!enabled()) {say('Image creation is not enabled on this app yet. You can still upload photos to ask questions.');return;}
    const options=Object.fromEntries(new FormData(form));
    options.prompt=options.prompt.trim();
    if(!options.prompt) {say('Describe the image you want.');return;}
    controller=new AbortController();const active=controller;
    submit.disabled=true;cancel.hidden=false;say('Creating your image… This may take a minute.');
    try {await onGenerate(options,active);if(!active.signal.aborted) dialog.close();}
    catch(error) {say(active.signal.aborted ? 'Generation cancelled. If creation had already started, API credits may still have been used.' : error.message || 'Image creation failed. Try again.');}
    finally {if(controller===active) controller=null;submit.disabled=false;cancel.hidden=true;}
  });
  return {close(){dialog.close();},open(options={}) {
    if(controller) return;
    form.elements.prompt.value=options.prompt || '';
    for(const key of ['style','size','quality']) if(options[key] && [...form.elements[key].options].some(o=>o.value===options[key])) form.elements[key].value=options[key];
    say(enabled() ? '' : 'Image creation is not enabled on this app yet.');
    if(!dialog.open) dialog.showModal();
    form.elements.prompt.focus();
  }};
}

// Route clear visual creation requests to the image composer. Ambiguous requests
// can always use the visible Create image control or the /image command.
export function imagePrompt(text) {
  if(typeof text!=='string') return null;
  const prompt=text.trim();
  if(/^\/image(?:\s|$)/i.test(prompt)) return prompt.replace(/^\/image\s*/i,'');
  const request=prompt.replace(/^(?:please\s+|can you\s+|could you\s+|would you\s+|help me\s+)+/i,'');
  if(!/^(?:create|generate|draw|paint|illustrate|design|make)\b/i.test(request)) return null;
  if(/\b(?:story|stori|poem|essay|lesson|quiz|code|website|app|plan|report|prompt|instructions|cv|resume)\b/i.test(request)) return null;
  if(!/\b(?:image|picture|photo|photograph|illustration|painting|portrait|poster|logo|artwork|wallpaper|landscape|classroom|sunset|forest|skyline)\b/i.test(request)) return null;
  return prompt;
}
