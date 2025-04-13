import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[openai/threads] Creating new thread...');
    const response = await fetch('https://api.openai.com/v1/threads', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v2',
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    console.log('[openai/threads] Response status:', response.status);
    console.log('[openai/threads] Thread ID:', data.id || 'No ID received');

    if (!response.ok) {
      console.error('[openai/threads] API error:', data.error);
      throw new Error(data.error?.message || 'Failed to create thread');
    }

    res.status(200).json(data);
  } catch (error: any) {
    console.error('[openai/threads] Error:', error);
    console.error('[openai/threads] Error details:', error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
} 