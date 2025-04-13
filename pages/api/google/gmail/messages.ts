import { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import { getToken } from 'next-auth/jwt';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    console.log('[gmail/messages] Starting request...');
    
    // Get OAuth token
    const token = await getToken({ 
      req,
      secret: process.env.NEXTAUTH_SECRET 
    });

    console.log('[gmail/messages] Token status:', {
      hasAccessToken: !!token?.accessToken,
      hasRefreshToken: !!token?.refreshToken,
      hasExpiry: !!token?.accessTokenExpires,
      expiryTime: token?.accessTokenExpires ? new Date(token.accessTokenExpires as number).toISOString() : null,
      isExpired: token?.accessTokenExpires ? Date.now() > (token.accessTokenExpires as number) : null
    });

    if (!token?.accessToken) {
      console.error('[gmail/messages] No access token found');
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Create OAuth2 client with proper credentials
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.NEXTAUTH_URL
    );

    console.log('[gmail/messages] Environment check:', {
      hasClientId: !!process.env.GOOGLE_CLIENT_ID,
      hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
      hasNextAuthUrl: !!process.env.NEXTAUTH_URL,
      nextAuthUrl: process.env.NEXTAUTH_URL
    });

    // Set credentials with both access and refresh tokens
    oauth2Client.setCredentials({
      access_token: token.accessToken as string,
      refresh_token: token.refreshToken as string,
      expiry_date: (token.accessTokenExpires as number) || undefined
    });

    // Initialize Gmail client
    const gmail = google.gmail({ 
      version: 'v1', 
      auth: oauth2Client 
    });

    // Calculate date for 4 weeks ago
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    const query = `after:${Math.floor(fourWeeksAgo.getTime() / 1000)}`;

    console.log('[gmail/messages] Starting message fetch:', {
      query,
      startTime: fourWeeksAgo.toISOString()
    });

    // Test the Gmail API connection first
    try {
      await gmail.users.getProfile({
        userId: 'me'
      });
      console.log('[gmail/messages] Successfully connected to Gmail API');
    } catch (error: any) {
      console.error('[gmail/messages] Failed to connect to Gmail API:', {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      return res.status(500).json({
        error: 'Failed to connect to Gmail API',
        details: error.message,
        code: error.code
      });
    }

    // Fetch all messages using pagination with optimized batching
    let allMessages: any[] = [];
    let pageToken: string | undefined;
    
    do {
      console.log('[gmail/messages] Fetching page', pageToken ? `with token ${pageToken}` : '(first page)');
      
      const messageList = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 100,
        pageToken
      });

      if (!messageList.data.messages) {
        console.log('[gmail/messages] No messages found on current page');
        break;
      }

      console.log('[gmail/messages] Found', messageList.data.messages.length, 'messages on current page');
      
      // Process messages in larger batches with metadata format
      const BATCH_SIZE = 25; // Increased batch size since we're using metadata
      for (let i = 0; i < messageList.data.messages.length; i += BATCH_SIZE) {
        const batch = messageList.data.messages.slice(i, i + BATCH_SIZE);
        
        console.log(`[gmail/messages] Processing batch ${i / BATCH_SIZE + 1}/${Math.ceil(messageList.data.messages.length / BATCH_SIZE)}`);
        
        // Fetch message metadata in parallel
        const messages = await Promise.all(
          batch.map(async (message) => {
            try {
              const fullMessage = await gmail.users.messages.get({
                userId: 'me',
                id: message.id!,
                format: 'metadata',
                metadataHeaders: ['Subject', 'From', 'Date']
              });

              const headers = fullMessage.data.payload?.headers || [];
              const subject = headers.find(h => h.name === 'Subject')?.value || '(No subject)';
              const from = headers.find(h => h.name === 'From')?.value || '(Unknown sender)';
              const date = fullMessage.data.internalDate 
                ? new Date(parseInt(fullMessage.data.internalDate)).toISOString()
                : new Date().toISOString();

              // Only store essential data initially
              return {
                id: message.id,
                threadId: fullMessage.data.threadId,
                subject,
                from,
                date,
                snippet: fullMessage.data.snippet || ''
              };
            } catch (error) {
              console.error('[gmail/messages] Error fetching message:', message.id, error);
              return null;
            }
          })
        );

        // Filter out failed messages and add to collection
        const validMessages = messages.filter((msg): msg is NonNullable<typeof msg> => msg !== null);
        allMessages = allMessages.concat(validMessages);
        
        // Get next page token
        pageToken = messageList.data.nextPageToken || undefined;
        
        console.log('[gmail/messages] Current total:', allMessages.length, 'messages');
      }
    } while (pageToken);

    console.log('[gmail/messages] Successfully processed all messages:', {
      total: allMessages.length,
      dateRange: {
        newest: allMessages.length > 0 ? new Date(allMessages[0].date).toISOString() : null,
        oldest: allMessages.length > 0 ? new Date(allMessages[allMessages.length - 1].date).toISOString() : null
      }
    });
    
    res.status(200).json({ messages: allMessages });
  } catch (error: any) {
    console.error('[gmail/messages] Error:', {
      message: error.message,
      stack: error.stack,
      response: error.response?.data
    });
    res.status(500).json({ 
      error: 'Failed to fetch messages', 
      details: error.message,
      code: error.code
    });
  }
} 