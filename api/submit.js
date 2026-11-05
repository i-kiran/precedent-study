// Server-side receiver for the participant-facing study.
// Requires a deployment with GITHUB_RESULTS_TOKEN and GITHUB_RESULTS_REPO
// (ideally a private responses repository). Do not expose either to client code.
const expected = new Map([
  [4663,["Accountability","Deep","Near"]],
  [3056,["Accountability","Deep","Far"]],
  [16230,["Accountability","Shallow","Near"]],
  [7407,["Accountability","Shallow","Far"]],
  [13115,["Safety","Deep","Near"]],
  [7723,["Safety","Deep","Far"]],
  [17048,["Safety","Shallow","Near"]],
  [43621,["Safety","Shallow","Far"]]
]);
const ORIGIN="https://i-kiran.github.io";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function plain(v, max=128) {
  if (v==null) return "";
  if(typeof v!=="string"||v.length>max||/[\r\n\0]/.test(v))throw Error("Invalid participant metadata");
  return v;
}
function escapeCsv(v) {
  let t=String(v==null?"":v);
  // Prevent CSV injection when opened in spreadsheets.
  if(/^[\t\r\n ]*[=+\-@]/.test(t))t="'"+t;
  return '"'+t.replace(/"/g,'""')+'"';
}
function validate(input) {
  const body=typeof input==="string"?JSON.parse(input):input;
  if(!body||typeof body!=="object"||Array.isArray(body))throw Error("Invalid request");
  const id=plain(body.review_id,36);
  if(!UUID.test(id))throw Error("Invalid response ID");
  if(!Array.isArray(body.responses)||body.responses.length!==8)throw Error("Expected eight ratings");
  const ids=body.prolific||{};
  const meta={pid:plain(ids.pid),study_id:plain(ids.study_id),session_id:plain(ids.session_id)};
  const startedAt=plain(body.started_at,40), completedAt=plain(body.completed_at,40);
  const byId=new Map(), seenOrders=new Set();
  for(const r of body.responses) {
    if(!r||!expected.has(r.case_id)||byId.has(r.case_id))throw Error("Unexpected or duplicate case ID");
    if(!Number.isInteger(r.relevance)||r.relevance<1||r.relevance>7)throw Error("Invalid relevance rating");
    if(r.confidence!=null&&(!Number.isInteger(r.confidence)||r.confidence<0||r.confidence>100))throw Error("Invalid confidence rating");
    if(typeof r.explanation!=="string"||r.explanation.length>2000)throw Error("Invalid explanation");
    if(!Number.isInteger(r.order)||r.order<1||r.order>8||seenOrders.has(r.order))throw Error("Invalid randomized order");
    if(r.response_time_ms!=null&&(!Number.isSafeInteger(r.response_time_ms)||r.response_time_ms<0||r.response_time_ms>86400000))throw Error("Invalid response time");
    seenOrders.add(r.order);
    byId.set(r.case_id,r);
  }
  return {id,meta,startedAt,completedAt,byId};
}
module.exports=async function handler(req,res) {
  res.setHeader("Cache-Control","no-store");
  res.setHeader("Vary","Origin");
  res.setHeader("Access-Control-Allow-Origin",ORIGIN);
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if(req.headers.origin!==ORIGIN)return res.status(403).json({saved:false,error:"Origin not permitted"});
  if(req.method==="OPTIONS")return res.status(204).end();
  if(req.method!=="POST")return res.status(405).json({saved:false,error:"POST required"});
  if(Number(req.headers["content-length"]||0)>30000)return res.status(413).json({saved:false,error:"Payload too large"});
  const token=process.env.GITHUB_RESULTS_TOKEN;
  const repository=process.env.GITHUB_RESULTS_REPO;
  const branch=process.env.GITHUB_RESULTS_BRANCH||"main";
  if(!token||!repository||!/^[\w.-]+\/[\w.-]+$/.test(repository))
    return res.status(503).json({saved:false,error:"Study storage not configured"});
  let info;
  try{info=validate(req.body);}
  catch(e){return res.status(400).json({saved:false,error:e.message});}
  const columns=["review_id","prolific_pid","prolific_study_id","prolific_session_id","started_at","completed_at","target_id","case_id","order","value","depth","distance","relevance_1_to_7","confidence_0_to_100","explanation","response_time_ms"];
  const timestamp=new Date().toISOString();
  const rows=[columns.join(",")];
  for(const [caseId,[value,depth,distance]] of expected){
    const r=info.byId.get(caseId);
    if(!r)return res.status(400).json({saved:false,error:"Missing case"});
    const values=[info.id,info.meta.pid,info.meta.study_id,info.meta.session_id,info.startedAt,timestamp,55,caseId,r.order,value,depth,distance,r.relevance,r.confidence??"",r.explanation,r.response_time_ms??""];
    rows.push(values.map(escapeCsv).join(","));
  }
  const encoded=Buffer.from(rows.join("\r\n")+"\r\n","utf8").toString("base64");
  const path="responses/"+info.id+".csv";
  const url="https://api.github.com/repos/"+repository+"/contents/"+path;
  const headers={
    "Accept":"application/vnd.github+json",
    "Authorization":"Bearer "+token,
    "X-GitHub-Api-Version":"2022-11-28",
    "Content-Type":"application/json",
    "User-Agent":"moral-case-relevance-collector"
  };
  try{
    const prior=await fetch(url+"?ref="+encodeURIComponent(branch),{headers});
    let sha;
    if(prior.status===200){sha=(await prior.json()).sha;}
    else if(prior.status!==404)throw Error("GitHub read error");
    const saved=await fetch(url,{
      method:"PUT",headers,
      body:JSON.stringify({message:"Save Prolific case responses "+info.id,content:encoded,branch,...(sha?{sha}:{})})
    });
    if(!saved.ok)throw Error("GitHub write error");
    return res.status(200).json({saved:true,review_id:info.id});
  }catch(e){
    return res.status(502).json({saved:false,error:"Response storage unavailable"});
  }
};
