export class WebGPUMipmapGenerator {
  constructor(device) {
    this.device = device;
    this.sampler = device.createSampler({minFilter: 'linear'});
    // We'll need a new pipeline for every texture format used.
    this.pipelines = {};
  }

  getMipmapPipeline(format) {
    let pipeline = this.pipelines[format];
    if (!pipeline) {
      // Shaders are shared between all pipelines, so only create once.
      if (!this.mipmapVertexShaderModule || !this.mipmapFragmentShaderModule) {
        this.mipmapVertexShaderModule = this.device.createShaderModule({
          code: `
            var<private> pos : array<vec2<f32>, 4> = array<vec2<f32>, 4>(
              vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, 1.0),
              vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0));
            var<private> tex : array<vec2<f32>, 4> = array<vec2<f32>, 4>(
              vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0),
              vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0));
            
            struct VertexOutput {
              [[builtin(position)]] position : vec4<f32>;
              [[location(0)]] texCoord : vec2<f32>;
            };

            [[stage(vertex)]]
            fn main([[builtin(vertex_index)]] vertexIndex : u32) -> VertexOutput {
              var output : VertexOutput;
              output.texCoord = tex[vertexIndex];
              output.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
              return output;
            }
          `,
        });

        this.mipmapFragmentShaderModule = this.device.createShaderModule({
          code: `
            [[binding(0), group(0)]] var imgSampler : sampler;
            [[binding(1), group(0)]] var img : texture_2d<f32>;

            [[stage(fragment)]]
            fn main([[location(0)]] texCoord : vec2<f32>) -> [[location(0)]] vec4<f32> {
              return textureSample(img, imgSampler, texCoord);
            }
          `,
        });
      }

      pipeline = this.device.createRenderPipeline({
        vertex: {
          module: this.mipmapVertexShaderModule,
          entryPoint: 'main',
        },
        fragment: {
          module: this.mipmapFragmentShaderModule,
          entryPoint: 'main',
          targets: [{format}],
        },
        primitive: {
          topology: 'triangle-strip',
          stripIndexFormat: 'uint32',
        },
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
  generateMipmap(texture, textureDescriptor) {
    // TODO: Does this need to handle sRGB formats differently?
    const pipeline = this.getMipmapPipeline(textureDescriptor.format);

    if (textureDescriptor.dimension == '3d' || textureDescriptor.dimension == '1d') {
      throw new Error('Generating mipmaps for non-2d textures is currently unsupported!');
    }

    let mipTexture = texture;
    const arrayLayerCount = textureDescriptor.size.depth || 1; // Only valid for 2D textures.

    // If the texture was created with RENDER_ATTACHMENT usage we can render directly between mip levels.
    const renderToSource = textureDescriptor.usage & GPUTextureUsage.RENDER_ATTACHMENT;
    if (!renderToSource) {
      // Otherwise we have to use a separate texture to render into. It can be one mip level smaller than the source
      // texture, since we already have the top level.
      const mipTextureDescriptor = {
        size: {
          width: Math.ceil(textureDescriptor.size.width / 2),
          height: Math.ceil(textureDescriptor.size.height / 2),
          depthOrArrayLayers: arrayLayerCount,
        },
        format: textureDescriptor.format,
        usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.SAMPLED | GPUTextureUsage.RENDER_ATTACHMENT,
        mipLevelCount: textureDescriptor.mipLevelCount - 1,
      };
      mipTexture = this.device.createTexture(mipTextureDescriptor);
    }

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
          arrayLayerCount: 1,
        });

        const passEncoder = commandEncoder.beginRenderPass({
          colorAttachments: [{
            view: dstView,
            loadValue: [0, 0, 0, 0],
            storeOp: 'store'
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
        depthOrArrayLayers: arrayLayerCount,
      };

      // TODO: This should use textureDescriptor.mipLevelCount isntead of textureDescriptor.mipLevelCount-1, but for
      // some reason it's telling me that I'm "touching outside the texture" if I do that.
      for (let i = 1; i < textureDescriptor.mipLevelCount-1; ++i) {
        commandEncoder.copyTextureToTexture({
          texture: mipTexture,
          mipLevel: i-1,
        }, {
          texture: texture,
          mipLevel: i,
        }, mipLevelSize);

        mipLevelSize.width = Math.ceil(mipLevelSize.width / 2);
        mipLevelSize.height = Math.ceil(mipLevelSize.height / 2);
      }
    }

    this.device.queue.submit([commandEncoder.finish()]);

    if (!renderToSource) {
      mipTexture.destroy();
    }

    return texture;
  }
}
