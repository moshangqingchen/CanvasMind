// Original, purpose-written shaders. No reference-project source or assets are used.
export const neuralVertexShader = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in float aGroup;
layout(location=2) in float aBrightness;
layout(location=3) in float aPhase;
layout(location=4) in float aSize;
layout(location=5) in float aDepth;
uniform vec2 uResolution;
uniform vec4 uNodes[5];
uniform vec3 uColors[5];
uniform float uTime;
uniform float uDpr;
uniform float uGrowth;
uniform float uHovered;
uniform float uSelected;
uniform float uKind;
uniform float uDeparture;
uniform float uIntro;
uniform float uLightTheme;
out vec3 vColor;
out float vLight;
out float vPhase;
out float vDepth;
out vec3 vNormal;
vec3 rotate(vec3 p, float a) {
  float c=cos(a),s=sin(a);
  p.xz=mat2(c,-s,s,c)*p.xz;
  p.yz=mat2(.985,-.1725,.1725,.985)*p.yz;
  return p;
}
void main(){
  int group=int(aGroup+.1);
  vec4 node=uNodes[group];
  vec3 p=aPosition;
  float clock=uTime*(group==0 ? .05 : .035);
  if(uKind<1.5) {
    p=rotate(p,clock+float(group)*.21);
    float distortion=sin(p.x*7.+p.y*5.+uTime*.18)*cos(p.z*6.-uTime*.13)*.018;
    if(group==0) p*=1.+distortion;
    else { p.x+=sin(p.y*3.+uTime*.25+float(group))*p.y*.055; }
  }
  float perspective=1.+p.z*.13;
  vec2 position=node.xy+p.xy*node.z*perspective;
  if(uKind>1.5&&uKind<2.5) {
    float t=aPosition.x;
    vec2 start=uNodes[0].xy;
    vec2 end=node.xy;
    vec2 delta=end-start;
    vec2 normal=normalize(vec2(-delta.y,delta.x));
    position=mix(start,end,t)+normal*(sin(t*3.14159265)*aPosition.y*18.+sin(t*6.283+uTime*.24)*aPosition.y*3.);
    p.z=0.;
  }
  if(uKind>2.5) position=node.xy+p.xy*node.z*(1.+uDeparture*3.5);
  float selectedFade=uSelected>0.5&&group!=0&&abs(uSelected-float(group))>.5?.55:1.;
  float hoverFade=uHovered>.5&&group!=0&&abs(uHovered-float(group))>.5?.25:1.;
  float hoverBoost=uHovered>.5&&abs(uHovered-float(group))<.5?1.8:1.;
  float grow=smoothstep(aDepth-.28,aDepth+.15,uGrowth);
  vLight=aBrightness*node.w*selectedFade*hoverFade*hoverBoost*grow*uIntro;
  vColor=uColors[group]; vPhase=aPhase; vDepth=p.z; vNormal=normalize(p);
  gl_Position=vec4(position/uResolution*vec2(2.,-2.)+vec2(-1.,1.),clamp(-p.z*.2,-.9,.9),1.);
  float pointScale=node.z/(min(uResolution.x,uResolution.y)*(group==0?.22:.052));
  gl_PointSize=max(1.,aSize*uDpr*(1.+p.z*.2)*(uKind<.5 ? 1. : 1.1)*(uLightTheme>.5?1.24:1.)*pointScale);
}`;

export const neuralLineFragment = `#version 300 es
precision highp float;
in vec3 vColor; in float vLight; in float vPhase; in float vDepth; in vec3 vNormal;
uniform float uTime; uniform float uKind; uniform float uLightTheme;
uniform vec3 uSilver; uniform vec3 uEmber; uniform vec3 uEmberLight;
out vec4 outColor;
void main(){
  float front=smoothstep(-.8,.7,vDepth)*.7+.3;
  float travel=.5+.5*sin(uTime*.7);
  float pulse=exp(-pow((vPhase-travel)*24.,2.));
  vec3 color=vColor;
  if(uKind<.5) { color=mix(uEmber,uSilver,smoothstep(.25,.9,vPhase)); }
  float alpha=vLight*front;
  if(uKind<.5) alpha*=uLightTheme>.5?.85:.7;
  if(uKind>1.5&&uKind<2.5) { alpha*=.82+pulse*4.; color=mix(color,uSilver,pulse*.28); }
  outColor=vec4(color,alpha*(uLightTheme>.5?1.15:1.));
}`;

export const neuralPointFragment = `#version 300 es
precision highp float;
in vec3 vColor; in float vLight; in float vPhase; in float vDepth; in vec3 vNormal;
uniform float uTime; uniform float uKind; uniform float uLightTheme;
uniform vec3 uSilver; uniform vec3 uEmber; uniform vec3 uEmberLight;
out vec4 outColor;
void main(){
  float d=length(gl_PointCoord-.5)*2.;
  if(d>1.) discard;
  float shape=exp(-d*d*4.5)*(1.-smoothstep(.7,1.,d));
  float flicker=.55+.45*sin(uTime*(.55+vPhase)+vPhase*37.);
  vec3 color=uKind<.5?mix(uEmber,uEmberLight,vPhase*vPhase*.35):vColor;
  float alpha=shape*vLight*(.7+.3*flicker);
  if(uKind<.5) { alpha*=1.15; color*=1.1; }
  outColor=vec4(color,alpha*(uLightTheme>.5?1.2:1.));
}`;

export const neuralShellFragment = `#version 300 es
precision highp float;
in vec3 vColor; in float vLight; in float vPhase; in float vDepth; in vec3 vNormal;
uniform vec3 uShell; uniform vec3 uSilver; uniform vec3 uEmber; uniform float uLightTheme;
out vec4 outColor;
void main(){
  if(vDepth<-.025) discard;
  float edge=pow(1.-abs(vNormal.z),3.5);
  float stone=fract(sin(dot(floor(vNormal*78.),vec3(127.1,311.7,74.7)))*43758.5453);
  float broad=sin(vNormal.x*11.+vNormal.y*5.)*.5+.5;
  vec3 color=mix(uShell,uSilver,(edge*.2+stone*.035+broad*.018)*(uLightTheme>.5?.7:1.));
  color*=.83+vPhase*.22;
  float opaque=(uLightTheme>.5?.84:.985)*smoothstep(-.03,.12,vDepth)*min(1.,vLight*3.);
  outColor=vec4(color,opaque);
}`;

export const neuralRimFragment = `#version 300 es
precision highp float;
in vec3 vColor; in float vLight; in float vPhase; in float vDepth; in vec3 vNormal;
uniform vec3 uSilver; uniform vec3 uEmber; uniform vec3 uEmberLight;
uniform float uTime; uniform float uLightTheme;
out vec4 outColor;
void main(){
  float front=smoothstep(-.25,.6,vDepth);
  float glow=.67+.33*sin(uTime*.42+vPhase*29.);
  vec3 color=mix(uEmber,uSilver,smoothstep(.3,.93,vPhase));
  outColor=vec4(color,vLight*front*glow*(uLightTheme>.5?.75:1.));
}`;

export const neuralFullscreenVertex = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){
  vec2 position=vec2((gl_VertexID<<1)&2,gl_VertexID&2);
  vUv=position;
  gl_Position=vec4(position*2.-1.,0.,1.);
}`;

export const neuralBackgroundFragment = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform vec2 uResolution; uniform vec4 uCore;
uniform vec3 uBackground; uniform vec3 uCenter; uniform vec3 uSilver; uniform vec3 uEmber;
uniform float uLightTheme; uniform float uFlash; uniform float uTime; uniform float uIntro;
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
void main(){
  vec2 uv=vec2(vUv.x,1.-vUv.y);
  float vignette=1.-smoothstep(.2,.8,length(uv-.5));
  vec3 color=mix(uBackground,uCenter,vignette*.8);
  vec2 delta=(uv*uResolution-uCore.xy)/max(1.,uCore.z);
  float r=length(delta);
  float halo=exp(-r*r*.46)*.29+exp(-pow((r-1.01)*3.1,2.))*.13;
  float ember=exp(-r*r*10.)*.32;
  if(uLightTheme>.5) { color=mix(color,uSilver,exp(-r*r*.65)*.035*uIntro); color=mix(color,uEmber,exp(-r*r*2.)*.06*uIntro); }
  else { color+=uSilver*halo*uIntro+uEmber*ember*uIntro; }
  color+=(hash(gl_FragCoord.xy)-.5)*.025;
  color=mix(color,uLightTheme>.5?uEmber:uSilver,uFlash*exp(-r*r*.55)*.48);
  outColor=vec4(color,1.);
}`;

export const neuralBlurFragment = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uTexture; uniform vec2 uStep; uniform float uExtract;
vec3 tap(vec2 p){ vec3 c=texture(uTexture,p).rgb; return uExtract>.5?max(c-vec3(.34),vec3(0.)):c; }
void main(){
  vec3 color=tap(vUv)*.227027;
  color+=(tap(vUv+uStep*1.384615)+tap(vUv-uStep*1.384615))*.316216;
  color+=(tap(vUv+uStep*3.230769)+tap(vUv-uStep*3.230769))*.070270;
  outColor=vec4(color,1.);
}`;

export const neuralCompositeFragment = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uTexture; uniform sampler2D uBloom; uniform float uBloomAmount;
void main(){ outColor=vec4(texture(uTexture,vUv).rgb+texture(uBloom,vUv).rgb*uBloomAmount,1.); }
`;
