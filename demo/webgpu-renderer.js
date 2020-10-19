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
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

import {WebGPUTextureTool} from '../src/webgpu-texture-tool.js';
import {mat4} from './gl-matrix/src/gl-matrix.js';

const SAMPLE_COUNT = 4;
const DEPTH_FORMAT = "depth24plus";

const identity = mat4.create();
const cubeSpin = mat4.create();
mat4.translate(cubeSpin, cubeSpin, [0.0, 0.0, -2.0]);
mat4.scale(cubeSpin, cubeSpin, [0.7, 0.7, 0.7]);

const wgslSrc = {
  backgroundVertex: `
    var<private> pos : array<vec2<f32>, 4> = array<vec2<f32>, 4>(
      vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0)
    );
    var<private> tex : array<vec2<f32>, 4> = array<vec2<f32>, 4>(
      vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0)
    );
    [[builtin(position)]] var<out> Position : vec4<f32>;
    [[builtin(vertex_idx)]] var<in> VertexIndex : i32;

    [[location(0)]] var<out> vTex : vec2<f32>;

    [[stage(vertex)]]
    fn main() -> void {
      vTex = tex[VertexIndex];
      Position = vec4<f32>(pos[VertexIndex], 0.0, 1.0);
      return;
    }
  `,
  fragment: `
    [[location(0)]] var<out> outColor : vec4<f32>;
    [[location(0)]] var<in> vTex : vec2<f32>;

    [[binding(1), set(0)]] var<uniform_constant> imgSampler : sampler;
    [[binding(2), set(0)]] var<uniform_constant> img : texture_sampled_2d<f32>;

    [[stage(fragment)]]
    fn main() -> void {
      outColor = textureSample(img, imgSampler, vTex);
      return;
    }
  `
};

class Tile2DRenderer {
  constructor(renderer) {
    this.device = renderer.device;

    const vertexSrc = `
      var<private> pos : array<vec2<f32>, 4> = array<vec2<f32>, 4>(
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, 1.0)
      );
      var<private> tex : array<vec2<f32>, 4> = array<vec2<f32>, 4>(
        vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0)
      );

      [[builtin(position)]] var<out> Position : vec4<f32>;
      [[builtin(vertex_idx)]] var<in> VertexIndex : i32;

      [[location(0)]] var<out> vTex : vec2<f32>;

      type TileUniforms = [[block]] struct {
        [[offset(0)]] modelViewMatrix : mat4x4<f32>;
      };
      [[set(0), binding(0)]] var<uniform> tileUniforms : TileUniforms;

      type FrameUniforms = [[block]] struct {
        [[offset(0)]] projectionMatrix : mat4x4<f32>;
      };
      [[set(1), binding(0)]] var<uniform> frameUniforms : FrameUniforms;

      [[stage(vertex)]]
      fn main() -> void {
        vTex = tex[VertexIndex];
        Position = frameUniforms.projectionMatrix * tileUniforms.modelViewMatrix * vec4<f32>(pos[VertexIndex], 0.0, 1.0);
        return;
      }
    `;

    const fragmentSrc = `
      [[location(0)]] var<out> outColor : vec4<f32>;
      [[location(0)]] var<in> vTex : vec2<f32>;

      [[set(0), binding(1)]] var<uniform_constant> imgSampler : sampler;
      [[set(0), binding(2)]] var<uniform_constant> img : texture_sampled_2d<f32>;

      [[stage(fragment)]]
      fn main() -> void {
        outColor = textureSample(img, imgSampler, vTex);
        return;
      }
    `;

    // Tile rendering setup
    this.pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [
          renderer.bindGroupLayouts.tile2D,
          renderer.bindGroupLayouts.frameUniforms,
        ]
      }),
      vertexStage: {
        module: this.device.createShaderModule({
          code: vertexSrc
        }),
        entryPoint: 'main'
      },
      fragmentStage: {
        module: this.device.createShaderModule({
          code: fragmentSrc
        }),
        entryPoint: 'main'
      },
      primitiveTopology: 'triangle-strip',
      vertexState: {
        indexFormat: 'uint32'
      },
      colorStates: [{
        format: renderer.swapChainFormat,
        colorBlend: {
          srcFactor: 'src-alpha',
          dstFactor: 'one-minus-src-alpha',
        },
        alphaBlend: {
          srcFactor: 'zero',
          dstFactor: 'one'
        }
      }],
      depthStencilState: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: DEPTH_FORMAT,
      },
      sampleCount: SAMPLE_COUNT,
    });
  }

  draw(passEncoder, tile) {
    if (tile.texture) {
      this.device.defaultQueue.writeBuffer(tile.uniformBuffer, 0, tile.modelView);
      passEncoder.setBindGroup(0, tile.bindGroup);
      passEncoder.draw(4);
    }
  }
}

class TileCubeRenderer {
  constructor(renderer) {
    this.device = renderer.device;

    const vertexSrc = `
      [[location(0)]] var<in> position : vec3<f32>;

      [[location(0)]] var<out> vTex : vec3<f32>;
      [[builtin(position)]] var<out> Position : vec4<f32>;

      type TileUniforms = [[block]] struct {
        [[offset(0)]] modelViewMatrix : mat4x4<f32>;
      };
      [[binding(0), set(0)]] var<uniform> tileUniforms : TileUniforms;

      type FrameUniforms = [[block]] struct {
        [[offset(0)]] projectionMatrix : mat4x4<f32>;
        [[offset(64)]] cubeSpin : mat4x4<f32>;
      };
      [[binding(0), set(1)]] var<uniform> frameUniforms : FrameUniforms;

      [[stage(vertex)]]
      fn main() -> void {
        vTex = normalize(position);
        Position = frameUniforms.projectionMatrix * tileUniforms.modelViewMatrix * frameUniforms.cubeSpin * vec4<f32>(position, 1.0);
        return;
      }
    `;

    const fragmentSrc = `
      [[location(0)]] var<out> outColor : vec4<f32>;
      [[location(0)]] var<in> vTex : vec3<f32>;

      [[binding(1), set(0)]] var<uniform_constant> imgSampler : sampler;
      [[binding(2), set(0)]] var<uniform_constant> img : texture_sampled_cube<f32>;

      [[stage(fragment)]]
      fn main() -> void {
        outColor = textureSample(img, imgSampler, vTex);
        return;
      }
    `;

    // Tile rendering setup
    this.pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [
          renderer.bindGroupLayouts.tileCube,
          renderer.bindGroupLayouts.frameUniforms,
        ]
      }),
      vertexStage: {
        module: this.device.createShaderModule({
          code: vertexSrc
        }),
        entryPoint: 'main'
      },
      fragmentStage: {
        module: this.device.createShaderModule({
          code: fragmentSrc
        }),
        entryPoint: 'main'
      },
      primitiveTopology: 'triangle-list',
      vertexState: {
        vertexBuffers: [
          {
            arrayStride: 3 * Float32Array.BYTES_PER_ELEMENT,
            attributes: [
              {
                shaderLocation: 0,
                format: 'float3',
                offset: 0,
              }
            ]
          }
        ]
      },
      colorStates: [{
        format: renderer.swapChainFormat,
        colorBlend: {
          srcFactor: 'src-alpha',
          dstFactor: 'one-minus-src-alpha',
        },
        alphaBlend: {
          srcFactor: 'zero',
          dstFactor: 'one'
        }
      }],
      depthStencilState: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: DEPTH_FORMAT,
      },
      sampleCount: SAMPLE_COUNT,
    });

    const vertexArray = new Float32Array([
       1.0,  1.0,  1.0, // 0
      -1.0,  1.0,  1.0, // 1
       1.0, -1.0,  1.0, // 2
      -1.0, -1.0,  1.0, // 3
       1.0,  1.0, -1.0, // 4
      -1.0,  1.0, -1.0, // 5
       1.0, -1.0, -1.0, // 6
      -1.0, -1.0, -1.0, // 7
    ]);

    this.vertexBuffer = this.device.createBuffer({
      size: vertexArray.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    this.device.defaultQueue.writeBuffer(this.vertexBuffer, 0, vertexArray);

    const indexArray = new Uint16Array([
      // PosX (Right)
      0, 2, 4,
      6, 4, 2,

      // NegX (Left)
      5, 3, 1,
      3, 5, 7,

      // PosY (Top)
      4, 1, 0,
      1, 4, 5,

      // NegY (Bottom)
      2, 3, 6,
      7, 6, 3,

      // PosZ (Front)
      0, 1, 2,
      3, 2, 1,

      // NegZ (Back)
      6, 5, 4,
      5, 6, 7,
    ]);

    this.indexBuffer = this.device.createBuffer({
      size: indexArray.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
    });
    this.device.defaultQueue.writeBuffer(this.indexBuffer, 0, indexArray);
  }

  draw(passEncoder, tile) {
    if (tile.texture) {
      this.device.defaultQueue.writeBuffer(tile.uniformBuffer, 0, tile.modelView);
      passEncoder.setBindGroup(0, tile.bindGroup);
      passEncoder.setVertexBuffer(0, this.vertexBuffer);
      passEncoder.setIndexBuffer(this.indexBuffer, 'uint16');
      passEncoder.drawIndexed(36);
    }
  }
}

export class WebGPURenderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('gpupresent');
    this.mipmaps = true;
  }

  async initialize() {
    this.adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance"
    });
    let extensions = [];

    if (this.adapter.extensions.indexOf('texture-compression-bc') != -1) {
      // This is the extension string the spec says SHOULD be used.
      extensions.push('texture-compression-bc');
    } else if (this.adapter.extensions.indexOf('textureCompressionBC') != -1) {
      // TODO: This is the string Chrome is exposing, but it's not the one in the spec.
      extensions.push('textureCompressionBC');
    }

    this.device = await this.adapter.requestDevice({extensions});
    // TODO: This shouldn't be necessary long-term.
    if (!this.device.extensions) {
      this.device.extensions = extensions;
    }
    this.textureTool = new WebGPUTextureTool(this.device);

    // Swap chain setup
    this.swapChainFormat = await this.context.getSwapChainPreferredFormat(this.device);
    this.swapChain = this.context.configureSwapChain({
      device: this.device,
      format: this.swapChainFormat
    });

    this.colorAttachment = {
      // attachment is acquired and set in onCanvasResize.
      attachment: undefined,
      // attachment is acquired and set in onFrame.
      resolveTarget: undefined,
      loadValue: {r: 0.0, g: 0.0, b: 0.0, a: 1.0},
    };

    this.depthAttachment = {
      // attachment is acquired and set in onCanvasResize.
      attachment: undefined,
      depthLoadValue: 1.0,
      depthStoreOp: 'store',
      stencilLoadValue: 0,
      stencilStoreOp: 'store',
    };

    this.renderPassDescriptor = {
      colorAttachments: [this.colorAttachment],
      depthStencilAttachment: this.depthAttachment
    };

    this.onCanvasResize(this.canvas.width, this.canvas.height);

    this.bindGroupLayouts = {
      tile2D: this.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX, type: 'uniform-buffer' },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, type: 'sampler' },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, type: 'sampled-texture' },
        ]
      }),
      tileCube: this.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX, type: 'uniform-buffer' },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, type: 'sampler' },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, type: 'sampled-texture', viewDimension: 'cube' },
        ]
      }),
      frameUniforms :this.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX, type: 'uniform-buffer' }
        ]
      })
    };

    this.tileSampler = this.device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      mipmapFilter: 'linear'
    });

    this.tile2DRenderer = new Tile2DRenderer(this);
    this.tileCubeRenderer = new TileCubeRenderer(this);

    this.frameUniformsBuffer = this.device.createBuffer({
      size: 32 * Float32Array.BYTES_PER_ELEMENT, // Enough for two matrices
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });

    this.frameUniformBindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayouts.frameUniforms,
      entries: [{
        binding: 0,
        resource: {
          buffer: this.frameUniformsBuffer,
        },
      }],
    });

    // Background rendering setup
    this.backgroundPipeline = this.device.createRenderPipeline({
      vertexStage: {
        module: this.device.createShaderModule({
          code: wgslSrc.backgroundVertex
        }),
        entryPoint: 'main'
      },
      fragmentStage: {
        module: this.device.createShaderModule({
          code: wgslSrc.fragment
        }),
        entryPoint: 'main'
      },
      primitiveTopology: 'triangle-strip',
      vertexState: {
        indexFormat: 'uint16'
      },
      colorStates: [{
        format: this.swapChainFormat,
      }],
      depthStencilState: {
        depthWriteEnabled: false,
        depthCompare: 'less',
        format: DEPTH_FORMAT,
      },
      sampleCount: SAMPLE_COUNT,
    });

    const checkerboard = await this.textureTool.loadTextureFromUrl('textures/checkerboard.png');

    this.backgroundBindGroup = this.device.createBindGroup({
      layout: this.backgroundPipeline.getBindGroupLayout(0),
      entries: [{
        binding: 1,
        resource: this.tileSampler,
      }, {
        binding: 2,
        resource: checkerboard.texture.createView(),
      }],
    });
  }

  onCanvasResize(width, height) {
    if (!this.device) return;

    const msaaColorTexture = this.device.createTexture({
      size: { width, height, depth: 1 },
      sampleCount: SAMPLE_COUNT,
      format: this.swapChainFormat,
      usage: GPUTextureUsage.OUTPUT_ATTACHMENT,
    });
    this.colorAttachment.attachment = msaaColorTexture.createView();

    const depthTexture = this.device.createTexture({
      size: { width, height, depth: 1 },
      sampleCount: SAMPLE_COUNT,
      format: DEPTH_FORMAT,
      usage: GPUTextureUsage.OUTPUT_ATTACHMENT
    });
    this.depthAttachment.attachment = depthTexture.createView();
  }

  initializeTile(tile) {
    tile.texture = null;
    tile.bindGroup = null;

    tile.uniformBuffer = this.device.createBuffer({
      size: 16 * Float32Array.BYTES_PER_ELEMENT, // Enough for one matrix
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });
  }

  updateTileWithResult(tile, result) {
    let view;
    let layout;
    switch (result.type) {
      case 'cube':
        view = result.texture.createView({dimension: 'cube'});
        layout = this.tileCubeRenderer.pipeline.getBindGroupLayout(0);
        break;
      default:
        view = result.texture.createView({dimension: '2d', arrayLayerCount: 1});
        layout = this.tile2DRenderer.pipeline.getBindGroupLayout(0);
        break;
    }

    const bindGroup = this.device.createBindGroup({
      layout,
      entries: [{
        binding: 0,
        resource: {
          buffer: tile.uniformBuffer,
        },
      },{
        binding: 1,
        resource: this.tileSampler,
      }, {
        binding: 2,
        resource: view,
      }],
    });

    tile.bindGroup = bindGroup;
    tile.texture = result.texture;
    tile.type = result.type;

    return result;
  }

  loadTextureFromUrl(tile, url) {
    return this.textureTool.loadTextureFromUrl(url, {mipmaps: this.mipmaps}).then((result) => {
      return this.updateTileWithResult(tile, result);
    }).catch((err) => {
      console.warn('Texture failed to load from URL: ', err);

      // If an error occurs plug in a solid color texture to fill it's place.
      const result = this.textureTool.createTextureFromColor(0.75, 0.0, 0.0);
      return this.updateTileWithResult(tile, result);
    });
  }

  loadTextureFromFile(tile, file) {
    return this.textureTool.loadTextureFromBlob(file, {filename: file.name, mipmaps: this.mipmaps}).then((result) => {
      return this.updateTileWithResult(tile, result);
    }).catch((err) => {
      console.warn('Texture failed to load from File: ', err);

      // If an error occurs plug in a solid color texture to fill it's place.
      const result = this.textureTool.createTextureFromColor(0.75, 0.0, 0.0);
      return this.updateTileWithResult(tile, result);
    });
  }

  onFrame(projectionMat, tiles, delta) {
    mat4.rotateY(cubeSpin, cubeSpin, delta / 2000);
    mat4.rotateX(cubeSpin, cubeSpin, delta / 3000);

    // Update the FrameUniforms buffer with the values that are used by every
    // program and don't change for the duration of the frame.
    this.device.defaultQueue.writeBuffer(this.frameUniformsBuffer, 0, projectionMat);
    this.device.defaultQueue.writeBuffer(this.frameUniformsBuffer, 64, cubeSpin);

    this.colorAttachment.resolveTarget = this.swapChain.getCurrentTexture().createView();

    const commandEncoder = this.device.createCommandEncoder({});

    const passEncoder = commandEncoder.beginRenderPass(this.renderPassDescriptor);

    // Draw a checkered background (mostly so we can see alpha effects).
    passEncoder.setPipeline(this.backgroundPipeline);
    passEncoder.setBindGroup(0, this.backgroundBindGroup);
    passEncoder.draw(4, 1, 0, 0);

    // Draw each tile.
    passEncoder.setBindGroup(1, this.frameUniformBindGroup);

    passEncoder.setPipeline(this.tile2DRenderer.pipeline);
    for (let tile of tiles) {
      if (tile.texture && tile.type == '2d') {
        this.tile2DRenderer.draw(passEncoder, tile);
      }
    }

    passEncoder.setPipeline(this.tileCubeRenderer.pipeline);
    for (let tile of tiles) {
      if (tile.texture && tile.type == 'cube') {
        this.tileCubeRenderer.draw(passEncoder, tile);
      }
    }

    passEncoder.endPass();
    this.device.defaultQueue.submit([commandEncoder.finish()]);
  }

  destroy() {
    if (this.textureTool) {
      this.textureTool.destroy();
    }
  }
}
