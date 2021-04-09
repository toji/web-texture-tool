var L={"image/jpeg":"rgb8unorm","image/png":"rgba8unorm","image/apng":"rgba8unorm","image/gif":"rgba8unorm","image/bmp":"rgb8unorm","image/webp":"rgba8unorm","image/x-icon":"rgba8unorm","image/svg+xml":"rgba8unorm"},G=typeof createImageBitmap!="undefined",v=class{constructor(){}static supportedMIMETypes(){return Object.keys(L)}async fromUrl(e,t,r){let o=L[r.mimeType];if(e.supportedFormatList.indexOf(o)==-1&&(o="rgba8unorm"),G){let s=await fetch(t),i=await createImageBitmap(await s.blob());return e.fromImageBitmap(i,o,r.mipmaps)}else return new Promise((s,i)=>{let n=new Image;n.addEventListener("load",()=>{s(e.textureFromImageElement(n,o,r.mipmaps))}),n.addEventListener("error",function(h){i(h)}),n.src=t})}async fromBlob(e,t,r){let o=L[t.type];if(e.supportedFormatList.indexOf(o)==-1&&(o="rgba8unorm"),G){let s=await createImageBitmap(t);return e.fromImageBitmap(s,o,r.mipmaps)}else return new Promise((s,i)=>{let n=new Image;n.addEventListener("load",()=>{s(e.fromImageElement(n,o,r.mipmaps))}),n.addEventListener("error",function(m){i(m)});let h=window.URL.createObjectURL(t);n.src=h})}async fromBuffer(e,t,r){let o=new Blob(t,{type:r.mimeType});return this.fromBlob(e,o,r)}destroy(){}};var N=import.meta.url.replace(/[^\/]*$/,""),M=class{constructor(e,t,r,o){this.client=e,this.options=t,this.resolve=r,this.reject=o}},u={},C=1;function W(a){let e=u[a.data.id];if(!e){a.data.error&&console.error(`Texture load failed: ${a.data.error}`),console.error(`Invalid pending texture ID: ${a.data.id}`);return}if(delete u[a.data.id],a.data.error){console.error(`Texture load failed: ${a.data.error}`),e.reject(`${a.data.error}`);return}let t=e.client.fromTextureData(a.data,e.options.mipmaps);e.resolve(t)}var g=class{constructor(e){let t=`${N}${e}`;this.worker=new Worker(t),this.worker.onmessage=W}async fromUrl(e,t,r){let o=C++;return this.worker.postMessage({id:o,url:t,supportedFormats:e.supportedFormats(),mipmaps:r.mipmaps,extension:r.extension}),new Promise((s,i)=>{u[o]=new M(e,r,s,i)})}async fromBlob(e,t,r){let o=await t.arrayBuffer();return this.fromBuffer(e,o,r)}async fromBuffer(e,t,r){let o=C++;return this.worker.postMessage({id:o,buffer:t,supportedFormats:e.supportedFormats(),mipmaps:r.mipmaps,extension:r.extension}),new Promise((s,i)=>{u[o]=new M(e,r,s,i)})}destroy(){if(this.worker){this.worker.terminate();let e=new Error("Texture loader was destroyed.");for(let t of u)t.reject(e)}}};var l=WebGLRenderingContext,f={rgb8unorm:{canGenerateMipmaps:!0,gl:{format:l.RGB,type:l.UNSIGNED_BYTE,sizedFormat:32849}},rgba8unorm:{canGenerateMipmaps:!0,gl:{format:l.RGBA,type:l.UNSIGNED_BYTE,sizedFormat:32856}},"rgb8unorm-srgb":{canGenerateMipmaps:!0,gl:{format:l.RGB,type:l.UNSIGNED_BYTE,sizedFormat:35904}},"rgba8unorm-srgb":{canGenerateMipmaps:!0,gl:{format:l.RGBA,type:l.UNSIGNED_BYTE,sizedFormat:35907}},rgb565unorm:{canGenerateMipmaps:!0,gl:{format:l.RGB,type:l.UNSIGNED_SHORT_5_6_5,sizedFormat:l.RGB565}},rgba4unorm:{canGenerateMipmaps:!0,gl:{format:l.RGBA,type:l.UNSIGNED_SHORT_4_4_4_4,sizedFormat:l.RGBA4}},rgba5551unorm:{canGenerateMipmaps:!0,gl:{format:l.RGBA,type:l.UNSIGNED_SHORT_5_5_5_1,sizedFormat:l.RGB5_A1}},bgra8unorm:{canGenerateMipmaps:!0},"bgra8unorm-srgb":{canGenerateMipmaps:!0},"bc1-rgb-unorm":{gl:{texStorage:!0,sizedFormat:33776},compressed:{blockBytes:8,blockWidth:4,blockHeight:4}},"bc2-rgba-unorm":{gl:{texStorage:!0,sizedFormat:33778},compressed:{blockBytes:16,blockWidth:4,blockHeight:4}},"bc3-rgba-unorm":{gl:{texStorage:!1,sizedFormat:33779},compressed:{blockBytes:16,blockWidth:4,blockHeight:4}},"bc7-rgba-unorm":{gl:{texStorage:!0,sizedFormat:36492},compressed:{blockBytes:16,blockWidth:4,blockHeight:4}},"etc1-rgb-unorm":{gl:{texStorage:!1,sizedFormat:36196},compressed:{blockBytes:8,blockWidth:4,blockHeight:4}},"etc2-rgba8unorm":{gl:{texStorage:!0,sizedFormat:37496},compressed:{blockBytes:16,blockWidth:4,blockHeight:4}},"astc-4x4-rgba-unorm":{gl:{texStorage:!0,sizedFormat:37808},compressed:{blockBytes:16,blockWidth:4,blockHeight:4}},"pvrtc1-4bpp-rgb-unorm":{gl:{texStorage:!1,sizedFormat:35840},compressed:{blockBytes:8,blockWidth:4,blockHeight:4}},"pvrtc1-4bpp-rgba-unorm":{gl:{texStorage:!1,sizedFormat:35842},compressed:{blockBytes:8,blockWidth:4,blockHeight:4}}};var T=class{constructor(e,t={}){this.texture=e,this.width=t.width||1,this.height=t.height||1,this.depth=t.depth||1,this.mipLevels=t.mipLevels||1,this.format=t.format||"rgba8unorm",this.type=t.type||"2d"}get glFormat(){return f[this.format].gl.format||null}get glSizedFormat(){return f[this.format].gl.sizedFormat}get glTarget(){switch(this.type){case"cube":return GL.TEXTURE_CUBE_MAP;case"2d":default:return GL.TEXTURE_2D}}},P=class{constructor(e,t,r,o=null,s={}){this.format=e,this.width=Math.max(1,t),this.height=Math.max(1,r),this.levels=[],o&&this.getLevel(0).setSlice(0,o,s)}getLevel(e,t={}){let r=this.levels[e];return r||(r=new _(this,e,t),this.levels[e]=r),r}},_=class{constructor(e,t,r){this.textureData=e,this.levelIndex=t,this.width=Math.max(1,r.width||this.textureData.width>>t),this.height=Math.max(1,r.height||this.textureData.height>>t),this.slices=[]}setSlice(e,t,r={}){if(this.slices[e]!=null)throw new Error("Cannot define an image slice twice.");let o=r.byteOffset||0,s=r.byteLength||0,i;t instanceof ArrayBuffer?(i=t,s||(s=i.byteLength-o)):(i=t.buffer,s||(s=t.byteLength-o),o+=t.byteOffset),this.slices[e]={buffer:i,byteOffset:o,byteLength:s}}},b=class{constructor(e,t){this.mimeTypes=e,this.callback=t,this.loader=null}getLoader(){return this.loader||(this.loader=this.callback()),this.loader}},U={jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",apng:"image/apng",gif:"image/gif",bmp:"image/bmp",webp:"image/webp",ico:"image/x-icon",cur:"image/x-icon",svg:"image/svg+xml",basis:"image/basis",ktx:"image/ktx",ktx2:"image/ktx2",dds:"image/vnd.ms-dds"},R=[new b(v.supportedMIMETypes(),()=>new v),new b(["image/basis"],()=>new g("workers/basis/basis-worker.js")),new b(["image/ktx","image/ktx2"],()=>new g("workers/ktx/ktx-worker.js")),new b(["image/vnd.ms-dds"],()=>new g("workers/dds-worker.js"))],c=Symbol("wtt/WebTextureClient"),w=Symbol("wtt/WebTextureLoaders"),E=document.createElement("a"),H=typeof createImageBitmap!="undefined",x={extension:null,mipmaps:!0};function k(a,e){if(!e)throw new Error("A valid MIME type must be specified.");let t=a[w][e];t||(t=a[w]["*"]);let r=t.getLoader();if(!r)throw new Error(`Failed to get loader for MIME type "${e}"`);return r}var I=class{constructor(e){this[c]=e,this[w]={};for(let t of R)for(let r of t.mimeTypes)this[w][r]=t;this[w]["*"]=R[0]}async fromUrl(e,t){if(!this[c])throw new Error("Cannot create new textures after object has been destroyed.");let r=Object.assign({},x,t);if(E.href=e,!r.mimeType){let s=E.pathname.lastIndexOf("."),i=s>-1?E.pathname.substring(s+1).toLowerCase():"*";r.mimeType=U[i]}return k(this,r.mimeType).fromUrl(this[c],E.href,r)}async fromBlob(e,t){if(!this[c])throw new Error("Cannot create new textures after object has been destroyed.");let r=Object.assign({},x,t);return k(this,e.type).fromBlob(this[c],e,r)}async fromBuffer(e,t){if(!this[c])throw new Error("Cannot create new textures after object has been destroyed.");let r=Object.assign({},x,t);if(!r.mimeType&&r.filename){let s=r.filename.lastIndexOf("."),i=s>-1?r.filename.substring(s+1).toLowerCase():null;r.mimeType=U[i]}return k(this,r.mimeType).fromBuffer(this[c],e,r)}async fromElement(e,t){if(!this[c])throw new Error("Cannot create new textures after object has been destroyed.");let r=Object.assign({},x,t);if(!H)return this[c].textureFromImageElement(e,"rgba8unorm",r.mipmaps);let o=await createImageBitmap(e);return this[c].fromImageBitmap(o,"rgba8unorm",r.mipmaps)}async fromImageBitmap(e,t){if(!this[c])throw new Error("Cannot create new textures after object has been destroyed.");let r=Object.assign({},x,t);return this[c].fromImageBitmap(e,"rgba8unorm",r.mipmaps)}fromColor(e,t,r,o=1,s="rgba8unorm"){if(!this[c])throw new Error("Cannot create new textures after object has been destroyed.");if(s!="rgba8unorm"&&s!="rgba8unorm-srgb")throw new Error('createTextureFromColor only supports "rgba8unorm" and "rgba8unorm-srgb" formats');let i=new Uint8Array([e*255,t*255,r*255,o*255]);return this[c].fromTextureData(new P(s,1,1,i),!1)}set allowCompressedFormats(e){this[c].allowCompressedFormats=!!e}get allowCompressedFormats(){return this[c].allowCompressedFormats}destroy(){this[c]&&(this[c].destroy(),this[c]=null)}};var B=class{constructor(e){this.device=e,this.sampler=e.createSampler({minFilter:"linear"}),this.pipelines={}}getMipmapPipeline(e){let t=this.pipelines[e];return t||((!this.mipmapVertexShaderModule||!this.mipmapFragmentShaderModule)&&(this.mipmapVertexShaderModule=this.device.createShaderModule({code:`
            var<private> pos : array<vec2<f32>, 4> = array<vec2<f32>, 4>(
              vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, 1.0),
              vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0));
            var<private> tex : array<vec2<f32>, 4> = array<vec2<f32>, 4>(
              vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0),
              vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0));

            [[builtin(position)]] var<out> outPosition : vec4<f32>;
            [[builtin(vertex_index)]] var<in> vertexIndex : i32;

            [[location(0)]] var<out> vTex : vec2<f32>;

            [[stage(vertex)]]
            fn main() -> void {
              vTex = tex[vertexIndex];
              outPosition = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
              return;
            }
          `}),this.mipmapFragmentShaderModule=this.device.createShaderModule({code:`
            [[binding(0), group(0)]] var imgSampler : sampler;
            [[binding(1), group(0)]] var img : texture_2d<f32>;

            [[stage(fragment)]]
            fn main([[location(0)]] vTex : vec2<f32>) -> [[location(0)]] vec4<f32> {
              return textureSample(img, imgSampler, vTex);
            }
          `})),t=this.device.createRenderPipeline({vertex:{module:this.mipmapVertexShaderModule,entryPoint:"main"},fragment:{module:this.mipmapFragmentShaderModule,entryPoint:"main",targets:[{format:e}]},primitive:{topology:"triangle-strip",stripIndexFormat:"uint32"}}),this.pipelines[e]=t),t}generateMipmap(e,t){let r=this.getMipmapPipeline(t.format);if(t.dimension=="3d"||t.dimension=="1d")throw new Error("Generating mipmaps for non-2d textures is currently unsupported!");let o=e,s=t.size.depth||1,i=t.usage&GPUTextureUsage.RENDER_ATTACHMENT;if(!i){let m={size:{width:Math.ceil(t.size.width/2),height:Math.ceil(t.size.height/2),depthOrArrayLayers:s},format:t.format,usage:GPUTextureUsage.COPY_SRC|GPUTextureUsage.SAMPLED|GPUTextureUsage.RENDER_ATTACHMENT,mipLevelCount:t.mipLevelCount-1};o=this.device.createTexture(m)}let n=this.device.createCommandEncoder({}),h=r.getBindGroupLayout(0);for(let m=0;m<s;++m){let d=e.createView({baseMipLevel:0,mipLevelCount:1,dimension:"2d",baseArrayLayer:m,arrayLayerCount:1}),p=i?1:0;for(let F=1;F<t.mipLevelCount;++F){let S=o.createView({baseMipLevel:p++,mipLevelCount:1,dimension:"2d",baseArrayLayer:m,arrayLayerCount:1}),y=n.beginRenderPass({colorAttachments:[{attachment:S,loadValue:[0,0,0,0]}]}),z=this.device.createBindGroup({layout:h,entries:[{binding:0,resource:this.sampler},{binding:1,resource:d}]});y.setPipeline(r),y.setBindGroup(0,z),y.draw(4,1,0,0),y.endPass(),d=S}}if(!i){let m={width:Math.ceil(t.size.width/2),height:Math.ceil(t.size.height/2),depthOrArrayLayers:s};for(let d=1;d<t.mipLevelCount-1;++d)n.copyTextureToTexture({texture:o,mipLevel:d-1},{texture:e,mipLevel:d},m),m.width=Math.ceil(m.width/2),m.height=Math.ceil(m.height/2)}return this.device.queue.submit([n.finish()]),i||o.destroy(),e}};var Y=typeof createImageBitmap!="undefined",$={"texture-compression-bc":["bc1-rgba-unorm","bc2-rgba-unorm","bc3-rgba-unorm","bc7-rgba-unorm"],textureCompressionBC:["bc1-rgba-unorm","bc2-rgba-unorm","bc3-rgba-unorm","bc7-rgba-unorm"]};function j(a,e){return Math.floor(Math.log2(Math.max(a,e)))+1}var O=class extends I{constructor(e,t){super(new A(e),t)}},A=class{constructor(e){this.device=e,this.allowCompressedFormats=!0,this.uncompressedFormatList=["rgba8unorm","rgba8unorm-srgb","bgra8unorm","bgra8unorm-srgb"],this.supportedFormatList=["rgba8unorm","rgba8unorm-srgb","bgra8unorm","bgra8unorm-srgb"];let t=e.features||e.extensions;for(let r of t){let o=$[r];o&&this.supportedFormatList.push(...o)}this.mipmapGenerator=new B(e)}supportedFormats(){return this.allowCompressedFormats?this.supportedFormatList:this.uncompressedFormatList}async fromImageBitmap(e,t,r){if(!this.device)throw new Error("Cannot create new textures after object has been destroyed.");let o=r?j(e.width,e.height):1,s=GPUTextureUsage.COPY_DST|GPUTextureUsage.SAMPLED,i={size:{width:e.width,height:e.height},format:t,usage:s,mipLevelCount:o},n=this.device.createTexture(i);return this.device.queue.copyImageBitmapToTexture({imageBitmap:e},{texture:n},i.size),r&&this.mipmapGenerator.generateMipmap(n,i),new T(n,{width:e.width,height:e.height,mipLevels:o,format:t})}async fromImageElement(e,t,r){if(!this.device)throw new Error("Cannot create new textures after object has been destroyed.");if(!Y)throw new Error("Must support ImageBitmap to use WebGPU. (How did you even get to this error?)");let o=await createImageBitmap(e);return this.textureFromImageBitmap(o,t,r)}fromTextureData(e,t){if(!this.device)throw new Error("Cannot create new textures after object has been destroyed.");let r=f[e.format];if(!r)throw new Error(`Unknown format "${e.format}"`);let o=r.compressed||{blockBytes:4,blockWidth:1,blockHeight:1};t=t&&r.canGenerateMipmaps;let s=e.levels.length>1?e.levels.length:t?j(e.width,e.height):1,i=GPUTextureUsage.COPY_DST|GPUTextureUsage.SAMPLED,n={size:{width:Math.ceil(e.width/o.blockWidth)*o.blockWidth,height:Math.ceil(e.height/o.blockHeight)*o.blockHeight,depthOrArrayLayers:e.depth},format:e.format,usage:i,mipLevelCount:s},h=this.device.createTexture(n);for(let m of e.levels){let d=Math.ceil(m.width/o.blockWidth)*o.blockBytes;for(let p of m.slices)this.device.queue.writeTexture({texture:h,mipLevel:m.levelIndex,origin:{z:p.sliceIndex}},p.buffer,{offset:p.byteOffset,bytesPerRow:d},{width:Math.ceil(m.width/o.blockWidth)*o.blockWidth,height:Math.ceil(m.height/o.blockHeight)*o.blockHeight})}return t&&this.mipmapGenerator.generateMipmap(h,n),new T(h,{width:e.width,height:e.height,depth:e.depth,mipLevels:s,format:e.format,type:e.type})}destroy(){this.device=null}};export{O as WebGPUTextureLoader};
//# sourceMappingURL=webgpu-texture-loader.js.map
