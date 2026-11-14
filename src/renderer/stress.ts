// GPU load for the stress test: a heavy fragment shader drawn repeatedly each frame.
// The number of passes adapts until each frame takes ~40 ms, so any GPU ends up fully busy.
declare global {
  interface Window { rigmindStress?: { lost(): void } }
}

const canvas = document.getElementById("c") as HTMLCanvasElement;
const gl = canvas.getContext("webgl2", { antialias: false, powerPreference: "high-performance" })!;
canvas.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  window.rigmindStress?.lost(); // the driver reset: unstable
});

const vs = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const fs = `#version 300 es
precision highp float; uniform float t; uniform vec2 r; out vec4 o;
void main(){
  vec2 uv = (gl_FragCoord.xy / r) * 2.0 - 1.0; vec3 c = vec3(0.0); float a = t;
  for (int i = 0; i < 320; i++) {
    float f = float(i) * 0.031;
    uv = vec2(uv.x * cos(a) - uv.y * sin(a), uv.x * sin(a) + uv.y * cos(a)) * 1.003;
    c += 0.004 * vec3(sin(uv.x * 9.0 + f + a), cos(uv.y * 7.0 - f), sin(length(uv) * 11.0 + f));
    a += 0.0007 * sin(f + c.x);
  }
  o = vec4(0.18 + 0.5 * abs(c.x), 0.25 + 0.4 * abs(c.y), 0.5 + 0.4 * abs(c.z), 1.0);
}`;
function shader(type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return s;
}
const prog = gl.createProgram()!;
gl.attachShader(prog, shader(gl.VERTEX_SHADER, vs));
gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, fs));
gl.linkProgram(prog);
gl.useProgram(prog);
const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
const loc = gl.getAttribLocation(prog, "p");
gl.enableVertexAttribArray(loc);
gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
const uT = gl.getUniformLocation(prog, "t"), uR = gl.getUniformLocation(prog, "r");

let passes = 2;
function frame(now: number) {
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(uR, canvas.width, canvas.height);
  const start = performance.now();
  for (let i = 0; i < passes; i++) {
    gl.uniform1f(uT, now / 1000 + i * 0.01);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  gl.finish();
  const ms = performance.now() - start;
  if (ms < 35) passes = Math.min(400, passes + 1);
  else if (ms > 60 && passes > 1) passes--;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
export {};
