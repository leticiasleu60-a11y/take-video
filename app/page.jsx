"use client";
import { useRef, useState } from "react";
import { fal } from "@fal-ai/client";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

const MODEL = "fal-ai/kling-video/o1/standard/video-to-video/edit";
export default function Home() {
  const [logged, setLogged] = useState(false);
  const [password, setPassword] = useState("");
  const [source, setSource] = useState(null);
  const [reference, setReference] = useState(null);
  const [duration, setDuration] = useState("3.5");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultUrl, setResultUrl] = useState("");
  const sourceRef = useRef(null), referenceRef = useRef(null);
  const ffmpegRef = useRef(null);

  async function login(e) {
    e.preventDefault(); setStatus("Verificando acesso...");
    const r = await fetch("/api/login", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({password}) });
    const data = await r.json();
    if (!r.ok) { setStatus(data.error || "Não foi possível entrar."); return; }
    setLogged(true); setPassword(""); setStatus("");
  }
  async function getFFmpeg() {
    if (ffmpegRef.current) return ffmpegRef.current;
    setStatus("Preparando o editor de vídeo (primeira vez pode demorar)...");
    const ff = new FFmpeg();
    ff.on("log", ({message}) => { if (message) setStatus(message.slice(-220)); });
    const base = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
    await ff.load({ coreURL: await toBlobURL(base + "/ffmpeg-core.js", "text/javascript"), wasmURL: await toBlobURL(base + "/ffmpeg-core.wasm", "application/wasm") });
    ffmpegRef.current = ff; return ff;
  }
  async function generate() {
    if (!source || !reference) { setStatus("Escolha o vídeo original e a foto ou vídeo de referência."); return; }
    const d = Number(duration);
    if (!Number.isFinite(d) || d < 3 || d > 10) { setStatus("A duração do trecho precisa ser entre 3 e 10 segundos para este modelo."); return; }
    setBusy(true); setResultUrl("");
    let stage = "preparação";
    try {
      fal.config({ proxyUrl: "/api/fal/proxy" });
      stage = "preparar editor de vídeo";
      const ff = await getFFmpeg();
      const ext = source.name.toLowerCase().endsWith(".mov") ? "mov" : "mp4";
      const sourceName = "source." + ext;
      stage = "ler vídeo original";
      await ff.writeFile(sourceName, await fetchFile(source));
      setStatus("Separando somente os primeiros " + d + " segundos...");
      await ff.exec(["-i", sourceName, "-t", String(d), "-vf", "fps=24,scale='if(gte(iw,ih),-2,720)':'if(gte(iw,ih),720,-2)'", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "24", "-an", "first.mp4"]);
      const firstBytes = await ff.readFile("first.mp4");
      const firstFile = new File([firstBytes], "primeiro-take.mp4", {type:"video/mp4"});
      if (firstFile.size > 200 * 1024 * 1024) throw new Error("O trecho inicial ficou maior que 200 MB. Reduza a qualidade ou a duração.");
      stage = "preparar imagem de referência";
      let referenceImage = reference;
      if (reference.type.startsWith("video/")) {
        const rext = reference.name.toLowerCase().endsWith(".mov") ? "mov" : "mp4";
        await ff.writeFile("reference." + rext, await fetchFile(reference));
        await ff.exec(["-i", "reference." + rext, "-frames:v", "1", "-vf", "scale=720:-2", "reference.jpg"]);
        referenceImage = new File([await ff.readFile("reference.jpg")], "referencia.jpg", {type:"image/jpeg"});
      }
      if (!referenceImage.type.startsWith("image/")) throw new Error("A referência precisa ser uma foto ou vídeo válido.");
      stage = "enviar arquivos para a IA";
      setStatus("Enviando o trecho e a referência com segurança para a IA...");
      const [videoUrl, imageUrl] = await Promise.all([fal.storage.upload(firstFile), fal.storage.upload(referenceImage)]);
      stage = "geração pela IA";
      setStatus("A IA está substituindo a pessoa no primeiro take. Isso pode levar alguns minutos...");
      const generated = await fal.subscribe(MODEL, { input: {
        video_url: videoUrl,
        elements: [{ frontal_image_url: imageUrl }],
        prompt: "Replace only the woman/ main person visible in the video with @Element1. Preserve the original scene, framing, camera movement, body pose, gestures, timing, clothing style where possible, lighting, background and every visible on-screen text exactly as in the source. Do not add captions, logos, objects, people or new text. Keep the same actions and composition.",
        keep_audio: true,
        enable_safety_checker: true
      }, logs: true, onQueueUpdate: (u) => { if (u.status === "IN_PROGRESS") setStatus("A IA está processando o primeiro take..."); } });
      const videoOut = generated?.data?.video?.url;
      if (!videoOut) throw new Error("A IA terminou, mas não retornou o vídeo editado.");
      stage = "baixar o vídeo gerado";
      setStatus("Baixando o take editado e juntando ao restante original...");
      const aiResponse = await fetch(videoOut);
      if (!aiResponse.ok) throw new Error("Não foi possível baixar o trecho editado.");
      await ff.writeFile("ai.mp4", new Uint8Array(await aiResponse.arrayBuffer()));
      stage = "juntar o take editado ao vídeo original";
      // Keep the complete original audio while replacing only the video frames in the selected opening segment.
      await ff.exec(["-i", "ai.mp4", "-ss", String(d), "-i", sourceName, "-filter_complex", "[0:v]scale=720:-2,fps=24,setsar=1[v0];[1:v]scale=720:-2,fps=24,setsar=1[v1];[v0][v1]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "1:a?", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "22", "-c:a", "aac", "-b:a", "192k", "-shortest", "resultado-final.mp4"]);
      const finalBytes = await ff.readFile("resultado-final.mp4");
      const url = URL.createObjectURL(new Blob([finalBytes], {type:"video/mp4"}));
      setResultUrl(url); setStatus("Vídeo final gerado. Confira o resultado antes de usar.");
    } catch (err) {
      console.error(err);
      const detail = err?.body?.detail || err?.body?.message || err?.message || "erro sem detalhes retornados";
      setStatus("Falha ao " + stage + ": " + String(detail).slice(0, 350) + ". Confira também se o vídeo é MP4/MOV e se o trecho inicial tem 3 a 10 segundos.");
    } finally { setBusy(false); }
  }
  if (!logged) return <main><section className="panel"><h1>Troca Take AI</h1><p>Entre com a senha privada do projeto.</p><form onSubmit={login}><label className="field">Senha</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/><div className="row" style={{marginTop:14}}><button>Entrar</button></div></form>{status && <div className="status">{status}</div>}</section></main>;
  return <main>
    <header><h1>✦ Troca Take AI</h1><p>Substitua a pessoa no começo do vídeo e mantenha o restante original.</p></header>
    <section className="panel"><h2>1. Vídeo original</h2><p className="muted">Envie o vídeo completo. O sistema separa o trecho inicial para edição.</p><input ref={sourceRef} type="file" accept="video/mp4,video/quicktime,video/webm" onChange={e=>setSource(e.target.files?.[0]||null)}/>{source && <small>{source.name} · {(source.size/1024/1024).toFixed(1)} MB</small>}</section>
    <section className="panel"><h2>2. Pessoa de referência</h2><p className="muted">Envie uma foto nítida de frente ou um vídeo de referência.</p><input ref={referenceRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" onChange={e=>setReference(e.target.files?.[0]||null)}/>{reference && <small>{reference.name}</small>}</section>
    <section className="panel"><h2>3. Primeiro take</h2><label className="field">Duração em segundos (3 a 10)</label><input type="number" min="3" max="10" step="0.5" value={duration} onChange={e=>setDuration(e.target.value)}/><p className="muted">Padrão: 3,5 segundos. O restante do vídeo será mantido a partir desse ponto.</p><div className="row"><button disabled={busy} onClick={generate}>{busy ? "Processando..." : "Gerar vídeo editado"}</button></div>{status && <div className="status" role="status">{status}</div>}{resultUrl && <><video className="preview" controls src={resultUrl}/><p><a href={resultUrl} download="video-editado.mp4">Baixar vídeo final</a></p></>}</section>
    <small>O processamento usa a API da fal.ai. A geração pode consumir créditos da sua conta.</small>
  </main>;
}
