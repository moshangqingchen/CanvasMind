import {expect,test} from "@playwright/test";
import sharp from "sharp";
import type {ModelDescriptor} from "@super-canvas/providers";
import type {ProviderConnectionView} from "../lib/client-api";
import {CANGYUAN_IMAGE_CONNECTOR} from "../lib/provider-presets";

test.beforeAll(() => {
  expect(process.env.PLAYWRIGHT_BASE_URL, "透明参考图回归只能使用隔离数据目录").toBeFalsy();
});

test("新旧辰途2.5组分别保存透明PNG，参考图证据与低档推定区分",async({page,request},info)=>{
  await page.setViewportSize({width:1600,height:1080});
  const label="透明参考图验收",model:ModelDescriptor={id:"gpt-image-2.5-sunburst",name:"Sunburst透明验收",operations:["image.generate","image.edit"],inputKinds:["text","image[]"],outputKinds:["image"],metadata:{canvasRunnable:true,supportsImageEdit:true},parameters:[
    {key:"size",label:"输出尺寸",control:"dimensions",valueType:"string",default:"auto",allowCustomValue:true,options:[{value:"auto",label:"自动"}]},
    {key:"quality",label:"质量",control:"select",default:"max",options:["low","medium","high","max"].map(value=>({value,label:value}))},
    {key:"output_format",label:"输出格式",control:"select",default:"png",options:["png","jpeg","webp"].map(value=>({value,label:value}))},
  ]};
  const newer="新渠道image2.5全参",older="image2.5全参",connections:ProviderConnectionView[]=[];
  let posts=0,upstream=0,reads=0;
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.route(/https:\/\/tu\.988236\.xyz\//,route=>{upstream++;return route.abort();});
  await page.route(/\/api\/runs(?:\?.*)?$/,route=>{if(route.request().method()==="POST"){posts++;return route.abort();}return route.continue();});
  await page.route(/\/api\/suppliers(?:\?.*)?$/,route=>route.fulfill({json:[]}));
  for(const group of [newer,older]){
    const created=await request.post("/api/providers",{data:{name:`隔离透明 ${group}`,provider:"rest",apiKey:"isolated-no-generation",config:{baseUrl:"https://transparent-reference.invalid",defaultModel:model.id,connector:{...structuredClone(CANGYUAN_IMAGE_CONNECTOR),models:[model]}}}});
    expect(created.ok()).toBeTruthy();const stored=await created.json();
    const connection:ProviderConnectionView={...stored,provider:"openai",apiKey:"",apiKeySet:true,apiKeyUsable:true,config:{supplierKey:"custom-chentu-transparency",supplierName:"辰途透明回归",usage:"canvas",baseUrl:"https://tu.988236.xyz/v1",modelGroup:group,accountKeyGroup:group,defaultModel:model.id,modelScanStatus:"live",scannedModelIds:[model.id],modelCatalogModels:[model]}};
    connections.push(connection);
    await page.route(`**/api/providers/${connection.id}/models*`,route=>{reads++;return route.fulfill({json:[model],headers:{"X-Model-Scan-Status":"live"}});});
  }
  await page.route(/\/api\/providers(?:\?.*)?$/,route=>route.fulfill({json:connections}));
  const referenceBytes=await sharp({create:{width:64,height:36,channels:4,background:"#5577dd"}}).png().toBuffer();
  const upload=await request.post("/api/assets/upload?name=transparent-reference-test.png",{headers:{"content-type":"image/png"},data:referenceBytes});
  expect(upload.status()).toBe(201);const reference=await upload.json();
  const created=await request.post("/api/canvas",{data:{title:"精确组透明参考隔离回归",graph:{schemaVersion:1,viewport:{x:0,y:0,zoom:1},edges:[{id:"reference-edit",source:"reference",sourceHandle:"asset",target:"edit",targetHandle:"references"}],nodes:[
    {id:"reference",type:"workflow",position:{x:60,y:90},data:{nodeType:"asset-input",label:"参考图",assetId:reference.id,assetKind:"image",outputs:[{id:"asset",kind:"image",label:"图片"}]}},
    {id:"edit",type:"workflow",position:{x:380,y:90},style:{width:420,height:210},data:{nodeType:"image-generation",label,provider:"openai",connectionId:connections[0]!.id,model:model.id,qualityMode:"custom",parameters:{size:"3840x2160",size_tier:"4K",quality:"max",background:"opaque",output_format:"jpeg",output_compression:80},parts:[],inputs:[{id:"prompt",kind:"text",label:"提示词"},{id:"references",kind:"image[]",label:"参考图",multiple:true}],outputs:[{id:"images",kind:"image",label:"图片"}]}},
  ]}}});
  expect(created.ok()).toBeTruthy();const canvas=await created.json();
  const saved=async()=> (await(await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes.find((n:{id:string})=>n.id==="edit").data;
  const open=()=>page.getByRole("button",{name:`打开 ${label} 模型与参数`,exact:true}).click();
  await page.goto(`/canvas/${canvas.id}`);await open();
  const panel=page.getByRole("dialog",{name:`${label} 模型与参数`,exact:true});
  const transparent=panel.getByRole("button",{name:"透明模式",exact:true});
  try{
    await expect(transparent).toBeVisible();await expect(panel.getByLabel("透明模式依据",{exact:true})).toContainText("参考编辑");
    await transparent.click();await expect.poll(async()=> (await saved()).parameters).toMatchObject({background:"transparent",output_format:"png",quality:"max",size:"3840x2160"});
    await expect.poll(async()=>Object.hasOwn((await saved()).parameters,"output_compression")).toBe(false);
    await panel.getByRole("button",{name:"1K",exact:true}).click();
    await expect.poll(async()=> (await saved()).parameters).toMatchObject({background:"transparent",output_format:"png",size_tier:"1K"});
    await expect(panel.getByLabel("透明模式依据",{exact:true})).toContainText("推定");
    const newerParameters={...(await saved()).parameters};
    const group=panel.getByRole("combobox",{name:`${label} 模型群组`,exact:true});
    await group.selectOption(older);await expect.poll(async()=> (await saved()).connectionId).toBe(connections[1]!.id);
    await panel.getByRole("button",{name:"普通模式",exact:true}).click();
    await panel.getByLabel("输出格式",{exact:true}).selectOption("webp");
    await expect.poll(async()=> (await saved()).parameters.output_format).toBe("webp");
    await group.selectOption(newer);await expect.poll(async()=> (await saved()).parameters).toEqual(newerParameters);
    await page.reload();await open();await expect(transparent).toHaveAttribute("aria-pressed","true");
    await expect.poll(async()=> (await saved()).parameters).toEqual(newerParameters);
    await expect(panel.getByLabel("输出格式",{exact:true})).toBeDisabled();
    await expect(panel.getByLabel("透明模式依据",{exact:true})).toContainText("推定");
    await panel.screenshot({path:info.outputPath("image-reference-transparent.png")});
  }finally{expect({posts,upstream}).toEqual({posts:0,upstream:0});expect(reads).toBeGreaterThan(0);expect(errors).toEqual([]);}
});

test("结果来源分开显示原PNG尺寸、透明像素和最高档请求",async({page,request},info)=>{
  const bytes=await sharp({create:{width:64,height:36,channels:4,background:{r:80,g:140,b:255,alpha:0.5}}}).png().toBuffer();
  const uploaded=await request.post("/api/assets/upload?name=original-alpha-ui-fixture.png",{headers:{"content-type":"image/png"},data:bytes});
  expect(uploaded.status()).toBe(201);const stored=await uploaded.json();
  const notice="请求3840×2160，原图实际64×36";
  const asset={...stored,metadata:{...stored.metadata,imageOutputVerified:true,imageFormat:"png",imageHasAlpha:true,imageHasTransparentPixels:true,imageHasVisiblePixels:true,imageRequestedSize:"3840x2160",imageRequestedWidth:3840,imageRequestedHeight:2160,imageDimensionsMatchRequest:false,imageOutputDimensionNotice:notice}};
  let posts=0;await page.route(/\/api\/runs(?:\?.*)?$/,route=>{if(route.request().method()==="POST"){posts++;return route.abort();}return route.continue();});
  await page.route(/\/api\/assets(?:\?.*)?$/,route=>route.fulfill({json:[asset]}));
  await page.route("**/api/runs/original-metadata-fixture?details=1",route=>route.fulfill({status:404,json:{error:"isolated history fixture"}}));
  const created=await request.post("/api/canvas",{data:{title:"原PNG参数展示隔离回归",graph:{schemaVersion:1,viewport:{x:0,y:0,zoom:1},edges:[],nodes:[{id:"result",type:"workflow",position:{x:180,y:180},style:{width:320,height:240},data:{nodeType:"asset-input",label:"原PNG核对",assetKind:"image",assetId:asset.id,generatedResult:true,generatedStatus:"succeeded",generatedFromRunId:"original-metadata-fixture",generatedFromNodeId:"deleted-source",generatedModel:"gpt-image-2.5-sunburst",generatedParameters:{size:"3840x2160",size_tier:"4K",quality:"max",background:"transparent",output_format:"png"},generatedDetails:{operation:"image.edit",inputAssetIds:[],outputCount:1},inputs:[],outputs:[]}}]}}});
  expect(created.ok()).toBeTruthy();const canvas=await created.json();await page.goto(`/canvas/${canvas.id}`);
  await page.getByRole("button",{name:"查看 原PNG核对 来源",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"结果来源与参数",exact:true});
  const value=(label:string)=>dialog.getByText(label,{exact:true}).locator("+ dd");
  await expect(value("实际尺寸")).toHaveText("64 × 36 像素");
  await expect(value("尺寸核对")).toHaveText(notice);
  await expect(value("原图透明")).toHaveText("原图含真实透明像素");
  expect(await(await request.get(`/api/assets/${asset.id}/content`)).body()).toEqual(bytes);
  expect(posts).toBe(0);
  await dialog.screenshot({path:info.outputPath("image-original-metadata.png")});
});
