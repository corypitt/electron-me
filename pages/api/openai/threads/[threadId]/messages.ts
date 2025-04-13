import type { NextApiRequest, NextApiResponse } from 'next';

interface ResponseWithFlush extends NextApiResponse {
  flush?: () => void;
}

export default async function handler(req: NextApiRequest, res: ResponseWithFlush) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { threadId } = req.query;
  const { content, assistant_id, context } = req.body;

  console.log('[openai/messages] Processing request:', {
    threadId,
    assistant_id,
    contentLength: content?.length || 0,
    hasContext: !!context
  });

  try {
    // Set up streaming headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    });

    console.log('[openai/messages] Adding message to thread...');
    // 1. Add the user message to the thread
    const messageResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v2',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: 'user',
        content: content,
      }),
    });

    console.log('[openai/messages] Message creation status:', messageResponse.status);
    const messageData = await messageResponse.json();
    console.log('[openai/messages] Message creation response:', messageData);

    if (!messageResponse.ok) {
      throw new Error(messageData.error?.message || 'Failed to add message to thread');
    }

    // 2. Add context as a system message if provided
    if (context) {
      console.log('[openai/messages] Adding context as system message...');
      const contextResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v2',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          role: 'user',
          content: `Here is the relevant context to help answer the user's question:\n\n${context}`,
        }),
      });

      if (!contextResponse.ok) {
        console.error('[openai/messages] Failed to add context message:', await contextResponse.json());
      }
    }

    console.log('[openai/messages] Starting assistant run...');
    // 3. Run the assistant with streaming enabled
    const runResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v2',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        assistant_id: assistant_id,
        stream: true,
      }),
    });

    console.log('[openai/messages] Run creation status:', runResponse.status);
    if (!runResponse.ok) {
      const error = await runResponse.json();
      console.error('[openai/messages] Run creation error:', error);
      throw new Error(error.error?.message || 'Failed to run assistant');
    }

    const reader = runResponse.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('No reader available in run response');
    }

    let buffer = '';

    function processEvent(data: string) {
      if (data === '[DONE]') {
        console.log('[openai/messages] Stream completed');
        res.write('data: [DONE]\n\n');
        if (res.flush) res.flush();
        return;
      }

      try {
        const event = JSON.parse(data);
        console.log('[openai/messages] Raw event:', JSON.stringify(event));
        
        // Handle message deltas (actual content streaming)
        if (event.type === 'message' || (event.object === 'thread.message.delta' && event.delta?.content?.[0]?.type === 'text')) {
          let text = '';
          if (event.type === 'message') {
            text = event.content || '';
          } else if (event.delta?.content?.[0]?.type === 'text') {
            text = event.delta.content[0].text.value;
          }
          
          if (text) {
            console.log('[openai/messages] Streaming text chunk:', text);
            const messageEvent = {
              type: 'content_block_delta',
              delta: { text }
            };
            res.write(`data: ${JSON.stringify(messageEvent)}\n\n`);
            if (res.flush) res.flush();
          }
        }
        // Handle completed messages
        else if (event.object === 'thread.message' && event.status === 'completed') {
          console.log('[openai/messages] Message completed');
          res.write('data: [DONE]\n\n');
          if (res.flush) res.flush();
        }
      } catch (err) {
        console.error('[openai/messages] Error processing event:', err, 'Raw data:', data);
      }
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log('[openai/messages] Reader done');
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;
        
        console.log('[openai/messages] Processing line:', trimmedLine);
        const data = trimmedLine.slice(5).trim();
        processEvent(data);
      }
    }

    // Process any remaining buffer content
    if (buffer.trim()) {
      const trimmedLine = buffer.trim();
      if (trimmedLine.startsWith('data: ')) {
        const data = trimmedLine.slice(5).trim();
        processEvent(data);
      }
    }

    console.log('[openai/messages] Stream ended successfully');
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error: any) {
    console.error('[openai/messages] Error:', error);
    console.error('[openai/messages] Error details:', error.response?.data || error.message);
    // If headers haven't been sent yet, send error as JSON
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      // If streaming has started, send error as SSE
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
} 