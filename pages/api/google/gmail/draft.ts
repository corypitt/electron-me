import { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from 'next-auth/react';
import { google } from 'googleapis';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const session = await getSession({ req });
    
    if (!session?.accessToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { threadId, content } = req.body;

    if (!threadId || !content) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      access_token: session.accessToken as string,
      refresh_token: session.refreshToken as string,
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Get the original email thread
    const thread = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
    });

    const lastMessage = thread.data.messages?.[thread.data.messages.length - 1];
    if (!lastMessage) {
      return res.status(404).json({ error: 'Email thread not found' });
    }

    // Get headers from the last message
    const headers = lastMessage.payload?.headers || [];
    const subject = headers.find(h => h.name?.toLowerCase() === 'subject')?.value || 'Re: No Subject';
    const to = headers.find(h => h.name?.toLowerCase() === 'from')?.value || '';

    // Create email content
    const email = [
      'Content-Type: text/plain; charset="UTF-8"\n',
      'MIME-Version: 1.0\n',
      'Content-Transfer-Encoding: 7bit\n',
      'to: ' + to + '\n',
      'subject: Re: ' + subject + '\n',
      '\n',
      content,
    ].join('');

    // Create draft
    const draft = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: {
          threadId: threadId,
          raw: Buffer.from(email).toString('base64url'),
        },
      },
    });

    res.status(200).json({ success: true, draftId: draft.data.id });
  } catch (error) {
    console.error('Error creating email draft:', error);
    res.status(500).json({ error: 'Failed to create email draft' });
  }
} 