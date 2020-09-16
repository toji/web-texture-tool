// Copyright 2020 Brandon Jones
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
// Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
// WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.s

// TODO: Replace shaders with WGSL, which won't require a separate compile
import glslangModule from './third-party/glslang/glslang.js'; // https://unpkg.com/@webgpu/glslang@0.0.7/web/glslang.js

export class WebGPUMipmapGenerator {
  constructor(device) {
    this.device = device;
    this.sampler = device.createSampler({minFilter: 'linear'});
    // We'll need a new pipeline for every texture format used.
    this.pipelines = {};

    this.shadersReady = glslangModule().then((glslang) => {
      // TODO: Convert to WGSL
      const mipmapVertexGLSL = `#version 450
        const vec2 pos[4] = vec2[4](vec2(-1.0f, 1.0f), vec2(1.0f, 1.0f), vec2(-1.0f, -1.0f), vec2(1.0f, -1.0f));
        const vec2 tex[4] = vec2[4](vec2(0.0f, 0.0f), vec2(1.0f, 0.0f), vec2(0.0f, 1.0f), vec2(1.0f, 1.0f));
        layout(location = 0) out vec2 vTex;
        void main() {
          vTex = tex[gl_VertexIndex];
          gl_Position = vec4(pos[gl_VertexIndex], 0.0, 1.0);
        }
      `;

      const mipmapVertexWGSL = `
        var<private> pos : array<vec2<f32>, 4> = array<vec2<f32>, 4>(
          vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0));
        var<private> tex : array<vec2<f32>, 4> = array<vec2<f32>, 4>(
          vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0));

        [[builtin position]] var<out> outPosition : vec4<f32>;
        [[builtin vertex_idx]] var<in> vertexIndex : i32;

        [[location 0]] var<out> vTex : vec2<f32>;

        fn vtx_main() -> void {
          vTex = tex[vertexIndex];
          outPosition = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
          return;
        }
        entry_point vertex as "main" = vtx_main;
      `;

      const mipmapFragmentGLSL = `#version 450
        layout(set = 0, binding = 0) uniform sampler imgSampler;
        layout(set = 0, binding = 1) uniform texture2D img;
        layout(location = 0) in vec2 vTex;
        layout(location = 0) out vec4 outColor;
        void main() {
          outColor = texture(sampler2D(img, imgSampler), vTex);
        }
      `;

      const mipmapFragmentWGSL = `
        [[binding 0, set 0]] var<uniform> imgSampler : sampler;
        [[binding 1, set 0]] var<uniform> img : texture_sampled_2d<f32>;

        [[location 0]] var<in> vTex : vec2<f32>;
        [[location 0]] var<out> outColor : vec4<f32>;

        fn frag_main() -> void {
          outColor = textureSample(img, imgSampler, vTex);
          return;
        }
        entry_point fragment as "main" = frag_main;
      `;

      this.mipmapVertexShaderModule = device.createShaderModule({
        code: mipmapVertexWGSL, //glslang.compileGLSL(mipmapVertexGLSL, 'vertex'),
      });
      this.mipmapFragmentShaderModule = device.createShaderModule({
        code: glslang.compileGLSL(mipmapFragmentGLSL, 'fragment'),
      });
    });
  }

  async getMipmapPipeline(format) {
    await this.shadersReady;
    let pipeline = this.pipelines[format];
    if (!pipeline) {
      pipeline = this.device.createRenderPipeline({
        vertexStage: {
          module: this.mipmapVertexShaderModule,
          entryPoint: 'main',
        },
        fragmentStage: {
          module: this.mipmapFragmentShaderModule,
          entryPoint: 'main',
        },
        primitiveTopology: 'triangle-strip',
        vertexState: {
          indexFormat: 'uint32'
        },
        colorStates: [{format}],
      });
      this.pipelines[format] = pipeline;
    }
    return pipeline;
  }

  /**
   * Generates mipmaps for the given GPUTexture from the data in level 0.
   *
   * @param {module:External.GPUTexture} texture - Texture to generate mipmaps for.
   * @param {object} textureDescriptor - GPUTextureDescriptor the texture was created with.
   * @returns {module:External.GPUTexture} - The originally passed texture
   */
  async generateMipmap(texture, textureDescriptor) {
    // TODO: Does this need to handle sRGB formats differently?
    const pipeline = await this.getMipmapPipeline(textureDescriptor.format);

    if (textureDescriptor.dimension == '3d' || textureDescriptor.dimension == '1d') {
      throw new Error('Generating mipmaps for non-2d textures is currently unsupported!');
    }

    let mipTexture = texture;
    const arrayLayerCount = textureDescriptor.size.depth || 1; // Only valid for 2D textures.

    // If the texture was created with OUTPUT_ATTACHMENT usage we can render directly between mip levels.
    const renderToSource = textureDescriptor.usage & GPUTextureUsage.OUTPUT_ATTACHMENT;
    if (!renderToSource) {
      // Otherwise we have to use a separate texture to render into. It can be one mip level smaller than the source
      // texture, since we already have the top level.
      const mipTextureDescriptor = {
        size: {
          width: Math.ceil(textureDescriptor.size.width / 2),
          height: Math.ceil(textureDescriptor.size.height / 2),
          depth: arrayLayerCount,
        },
        format: textureDescriptor.format,
        usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.SAMPLED | GPUTextureUsage.OUTPUT_ATTACHMENT,
        mipLevelCount: textureDescriptor.mipLevelCount - 1,
      };
      mipTexture = this.device.createTexture(mipTextureDescriptor);
    }

    this.device.pushErrorScope("validation");

    const commandEncoder = this.device.createCommandEncoder({});
    // TODO: Consider making this static.
    const bindGroupLayout = pipeline.getBindGroupLayout(0);

    for (let arrayLayer = 0; arrayLayer < arrayLayerCount; ++arrayLayer) {
      let srcView = texture.createView({
        baseMipLevel: 0,
        mipLevelCount: 1,
        dimension: '2d',
        baseArrayLayer: arrayLayer,
        arrayLayerCount: 1,
      });

      let dstMipLevel = renderToSource ? 1 : 0;
      for (let i = 1; i < textureDescriptor.mipLevelCount; ++i) {
        const dstView = mipTexture.createView({
          baseMipLevel: dstMipLevel++,
          mipLevelCount: 1,
          dimension: '2d',
          baseArrayLayer: arrayLayer,
          arrayLayerCount: 1
        });

        const passEncoder = commandEncoder.beginRenderPass({
          colorAttachments: [{
            attachment: dstView,
            loadValue: [0, 0, 0, 0],
          }],
        });

        const bindGroup = this.device.createBindGroup({
          layout: bindGroupLayout,
          entries: [{
            binding: 0,
            resource: this.sampler,
          }, {
            binding: 1,
            resource: srcView,
          }],
        });

        passEncoder.setPipeline(pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.draw(4, 1, 0, 0);
        passEncoder.endPass();

        srcView = dstView;
      }
    }

    // If we didn't render to the source texture, finish by copying the mip results from the temporary mipmap texture
    // to the source.
    if (!renderToSource) {
      const mipLevelSize = {
        width: Math.ceil(textureDescriptor.size.width / 2),
        height: Math.ceil(textureDescriptor.size.height / 2),
        depth: arrayLayerCount,
      };

      for (let i = 1; i < textureDescriptor.mipLevelCount-1; ++i) {
        commandEncoder.copyTextureToTexture({
          texture: mipTexture,
          mipLevel: i-1
        }, {
          texture: texture,
          mipLevel: i
        }, mipLevelSize);

        mipLevelSize.width = Math.ceil(mipLevelSize.width / 2);
        mipLevelSize.height = Math.ceil(mipLevelSize.height / 2);
      }
    }

    this.device.defaultQueue.submit([commandEncoder.finish()]);

    this.device.popErrorScope().then((error) => {
      if (error) {
        console.error("Error ", error.message, " occured with: ", textureDescriptor);
      }
    });

    if (!renderToSource) {
      mipTexture.destroy();
    }

    return texture;
  }
}