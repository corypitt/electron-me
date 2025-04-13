import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[openai/assistants] Checking API key...');
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key is not configured');
    }
    console.log('[openai/assistants] API key is configured');

    console.log('[openai/assistants] Fetching assistants...');
    const response = await fetch('https://api.openai.com/v1/assistants', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v2',
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    console.log('[openai/assistants] Response status:', response.status);
    console.log('[openai/assistants] Assistants count:', data.data?.length || 0);

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to fetch assistants');
    }

    res.status(200).json(data);
  } catch (error: any) {
    console.error('[openai/assistants] Error:', error);
    console.error('[openai/assistants] Error details:', error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
} 