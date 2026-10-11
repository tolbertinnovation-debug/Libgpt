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
  let controller=null,discussion='';
  const say=message=>{status.textContent=message;status.hidden=!message;};
  const close=()=>{controller?.abort();dialog.close();};
  dialog.querySelector('[data-image-close]').addEventListener('click',close);
  dialog.addEventListener('cancel',()=>controller?.abort());
  cancel.addEventListener('click',()=>controller?.abort());
  const generate=async(options={})=>{
    if(controller) throw new Error('An image is already being created.');
    if(!enabled()) throw new Error('Image creation is not enabled on this app yet.');
    const prompt=String(options.prompt || '').trim();
    if(!prompt) throw new Error('Describe the image you want.');
    controller=new AbortController();const active=controller;
    submit.disabled=true;
    // Keep progress and cancellation in the conversation, not over it.
    dialog.close();
    try {await onGenerate({style:'natural',size:'1024x1024',quality:'high',...options,prompt},active);}
    finally {if(controller===active) controller=null;submit.disabled=false;cancel.hidden=true;}
  };
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(controller) return;
    if(!enabled()) {say('Image creation is not enabled on this app yet. You can still upload photos to ask questions.');return;}
    const options={...Object.fromEntries(new FormData(form)),context:discussion};
    options.prompt=options.prompt.trim();
    if(!options.prompt) {say('Describe the image you want.');return;}
    try {await generate(options);}
    catch(error) {say(error.message || 'Image creation failed. Try again.');}
  });
  return {generate,close(){dialog.close();},open(options={}) {
    if(controller) return;
    discussion=typeof options.context==='string' ? options.context : '';
    form.elements.prompt.value=options.prompt || '';
    for(const key of ['style','size','quality']) if(options[key] && [...form.elements[key].options].some(o=>o.value===options[key])) form.elements[key].value=options[key];
    say(enabled() ? '' : 'Image creation is not enabled on this app yet.');
    if(!dialog.open) dialog.showModal();
    form.elements.prompt.focus();
  }};
}

// Identify clear visual creation requests for direct image generation. Ambiguous requests
// can always use the visible Create image control or the /image command.
export function imagePrompt(text) {
  if(typeof text!=='string') return null;
  const prompt=text.trim();
  if(/^\/image(?:\s|$)/i.test(prompt)) return prompt.replace(/^\/image\s*/i,'');
  let request=prompt.replace(/^(?:please\s+|can you\s+|could you\s+|would you\s+|help me\s+)+/i,'');
  request=request.replace(/^i (?:want|would like) to (?:see|view)\s+/i,'show ');
  if(!/^(?:create|generate|draw|paint|illustrate|design|make|show)\b/i.test(request)) return null;
  if(/\b(?:story|stori|poem|essay|lesson|quiz|code|website|app|plan|report|prompt|instructions|cv|resume)\b/i.test(request)) return null;
  if(!/\b(?:image|picture|photo|photograph|illustration|painting|portrait|poster|logo|artwork|wallpaper|flag|map|diagram|chart|landscape|classroom|sunset|forest|skyline)\b/i.test(request)) return null;
  return prompt;
}

export function imageLoadingMarkup() {
  return '<div class="image-generation-status" role="status" aria-live="polite"><div class="image-generation-heading"><span class="image-generation-spinner" aria-hidden="true"></span><strong>Creating your image…</strong></div><div class="image-generation-preview" aria-hidden="true"></div><progress aria-label="Image generation in progress"></progress><p>This may take a minute. Use Stop to cancel.</p></div>';
}

