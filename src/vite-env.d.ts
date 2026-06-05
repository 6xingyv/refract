/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />

// WGSL shaders imported as raw strings (Vite ?raw suffix)
declare module "*.wgsl?raw" {
  const src: string;
  export default src;
}
declare module "*.inc?raw" {
  const src: string;
  export default src;
}
