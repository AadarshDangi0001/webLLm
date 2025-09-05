import React, { useState, useEffect, useRef } from 'react'
import * as webllm from "@mlc-ai/web-llm"
import './app.scss'

const App = () => {


  const [engine, setEngine] = useState(null);
  const [initStatus, setInitStatus] = useState("Initializing...");
  const [modelLoaded, setModelLoaded] = useState(false);
  const abortRef = useRef(null);
  const DEBUG = true;
  const dlog = (...args) => { if (DEBUG) console.log('[WEBLLM]', ...args); };

  useEffect(() => {
    const selectedModel = "Llama-3.1-8B-Instruct-q4f32_1-MLC"; // change if unsupported
    let disposed = false;
    (async () => {
      try {
        dlog('Requested model:', selectedModel);
        const eng = await webllm.CreateMLCEngine(selectedModel, {
          initProgressCallback: (report) => {
            if (disposed) return;
            setInitStatus(report.text || 'Loading...');
            if (report.progress === 1) {
              setModelLoaded(true);
            }
            dlog('Initialization Progress:', report);
          }
        });
        if (disposed) return;
        setEngine(eng);
        dlog('Engine created. Available top-level keys:', Object.keys(eng));
        if (eng.chat) {
          dlog('Engine.chat keys:', Object.keys(eng.chat));
          if (eng.chat.completions) {
            dlog('Engine.chat.completions is present.');
          } else {
            dlog('WARNING: eng.chat.completions missing');
          }
        } else {
          dlog('WARNING: engine.chat is undefined – API may differ.');
        }
      } catch (e) {
        console.error('Engine initialization failed:', e);
        setInitStatus('Initialization failed: ' + (e?.message || e));
      }
    })();
    return () => { disposed = true; if (abortRef.current) abortRef.current.abort(); };
  },[]);


  const [messages, setMessages]= useState([
    { role: 'system', content: 'You are a helpful AI assistant.' }
  ]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // Send user message to LLM and update chat
  const handleSend = async () => {
    if (!input.trim() || !engine || loading) return;
    if (!engine?.chat?.completions?.create) {
      dlog('chat.completions.create not found on engine:', engine);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Chat API not available in this build.' }]);
      return;
    }
    const userMsg = { role: 'user', content: input };
    setInput('');
    setLoading(true);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const controller = abortRef.current;
    const startTime = performance.now();
    setMessages(prev => [...prev, userMsg]);
    try {
      const currentMessages = [...messages.filter(m => m.role !== 'assistant' || m.content.trim() !== 'Typing...'), userMsg];
      dlog('Sending messages to model:', currentMessages);
      const stream = await engine.chat.completions.create({
        messages: currentMessages,
        stream: true,
        temperature: 0.7,
        max_tokens: 512,
        signal: controller.signal
      });
      let assistantAccum = '';
      for await (const chunk of stream) {
        // Each chunk shape may vary; inspect keys first
        dlog('Chunk raw:', chunk);
        const piece = chunk?.choices?.[0]?.delta?.content || '';
        if (piece) assistantAccum += piece;
        setMessages(prev => {
          if (prev.length > 0 && prev[prev.length - 1].role === 'assistant') {
            return [...prev.slice(0, -1), { role: 'assistant', content: assistantAccum }];
          }
          return [...prev, { role: 'assistant', content: assistantAccum || ' ' }];
        });
      }
      const elapsed = ((performance.now() - startTime)/1000).toFixed(2)+'s';
      dlog('Generation completed in', elapsed, 'chars:', assistantAccum.length);
    } catch (err) {
      if (err.name === 'AbortError') {
        dlog('Generation aborted by user.');
      } else {
        console.error('Generation error:', err);
        setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + (err.message || 'Unknown error') }]);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setLoading(false);
    }
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') handleSend();
  };

  return (
    <main>
      <section>
        <div className="conversation-area">
          <div className="messages">
            {
              messages.filter(m => m.role !== 'system').map((msg, index) => (
                <div key={index} className={`message ${msg.role === 'assistant' ? 'model' : msg.role}`}>
                  {msg.content}
                </div>
              ))
            }
            {loading && (
              <div className="message model">Typing...</div>
            )}
          </div>
          <div className="input-area">
            <input
              type="text"
              placeholder="Message LLm"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleInputKeyDown}
              disabled={!engine || loading}
            />
            {!loading && (
              <button onClick={handleSend} disabled={!engine || !input.trim()}>
                Send
              </button>)}
            {loading && (
              <button onClick={handleCancel} className="cancel-btn">Stop</button>
            )}
          </div>
          {!modelLoaded && (
            <div style={{position:'absolute', top:10, left:'50%', transform:'translateX(-50%)', fontSize:'0.8rem', opacity:0.8}}>
              {initStatus}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

export default App
