// Email store types and interfaces
export interface EmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  body?: string;
  snippet: string;
  isFullyLoaded?: boolean;
}

interface EmailThread {
  messages: EmailMessage[];
}

// In-memory store for emails
let emailStore: { [threadId: string]: EmailMessage[] } = {};
let lastSyncTime: Date | null = null;
let isSyncing = false;
let lastSyncError: Error | null = null;

export function getEmailStoreStatus() {
  const allEmails = Object.values(emailStore).flat();
  // Sort by date, newest first
  const sortedEmails = allEmails.sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  
  return {
    threadCount: Object.keys(emailStore).length,
    messageCount: allEmails.length,
    lastSyncTime,
    isSyncing,
    lastSyncError: lastSyncError?.message || null,
    hasData: Object.keys(emailStore).length > 0,
    newestEmail: sortedEmails[0]?.date ? new Date(sortedEmails[0].date).toLocaleString() : null,
    oldestEmail: sortedEmails[sortedEmails.length - 1]?.date ? 
      new Date(sortedEmails[sortedEmails.length - 1].date).toLocaleString() : null,
    allEmails: sortedEmails
  };
}

async function fetchWithRetry(url: string, options: RequestInit = {}, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`[emailService] Attempt ${i + 1} of ${retries} for ${url}`);
      const response = await fetch(url, options);
      
      if (response.ok || response.status === 404) {
        console.log(`[emailService] Request successful: ${response.status}`);
        return response;
      }
      
      const errorData = await response.json().catch(() => ({}));
      console.log(`[emailService] Request failed:`, {
        status: response.status,
        statusText: response.statusText,
        error: errorData
      });
      
      // If we get a 401, we need to refresh the token
      if (response.status === 401) {
        console.log('[emailService] Token expired, refreshing session...');
        const sessionResponse = await fetch('/api/auth/session');
        console.log('[emailService] Session refresh response:', sessionResponse.status);
        continue;
      }
      
      // For other errors, wait before retrying
      const delay = Math.min(1000 * Math.pow(2, i), 5000);
      console.log(`[emailService] Attempt ${i + 1} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    } catch (error) {
      console.error(`[emailService] Network error on attempt ${i + 1}:`, error);
      if (i === retries - 1) throw error;
      const delay = Math.min(1000 * Math.pow(2, i), 5000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries reached');
}

export async function syncEmails(force: boolean = false): Promise<void> {
  // Don't sync if already syncing
  if (isSyncing) {
    console.log('[emailService] Sync already in progress, skipping...');
    return;
  }

  // Don't sync if we have data and last sync was recent (unless forced)
  const hasRecentSync = lastSyncTime && (Date.now() - lastSyncTime.getTime() < 5 * 60 * 1000);
  if (!force && hasRecentSync && Object.keys(emailStore).length > 0) {
    console.log('[emailService] Using cached data from recent sync');
    return;
  }
  
  isSyncing = true;
  lastSyncError = null;
  const startTime = Date.now();
  
  try {
    console.log('[emailService] Starting email sync...');
    console.log('[emailService] Store status before sync:', {
      threads: Object.keys(emailStore).length,
      messages: Object.values(emailStore).reduce((acc, msgs) => acc + msgs.length, 0)
    });

    const response = await fetchWithRetry('/api/google/gmail/messages?weeks=4');
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[emailService] Sync failed:', {
        status: response.status,
        statusText: response.statusText,
        error: errorData
      });
      throw new Error(`HTTP error! status: ${response.status}, details: ${JSON.stringify(errorData)}`);
    }
    
    const data = await response.json();
    console.log('[emailService] Received response:', {
      hasMessages: !!data.messages,
      messageCount: data.messages?.length || 0,
      dataType: typeof data.messages,
      sample: data.messages?.[0] ? {
        id: data.messages[0].id,
        threadId: data.messages[0].threadId,
        hasSubject: !!data.messages[0].subject,
        date: data.messages[0].date
      } : null
    });
    
    if (!Array.isArray(data.messages)) {
      console.error('[emailService] Invalid response format:', data);
      throw new Error('Invalid response format: messages is not an array');
    }

    if (data.messages.length === 0) {
      console.warn('[emailService] No messages returned from API');
      return;
    }

    // Log message dates to verify time window
    const messageDates = data.messages.map((msg: EmailMessage) => new Date(msg.date))
      .sort((a: Date, b: Date) => b.getTime() - a.getTime());
    console.log('[emailService] Message date range:', {
      newest: messageDates[0]?.toISOString(),
      oldest: messageDates[messageDates.length - 1]?.toISOString(),
      count: messageDates.length
    });
    
    // Validate message format before clearing store
    const invalidMessages = data.messages.filter((msg: { id?: string, threadId?: string }) => 
      !msg.id || !msg.threadId // Only require the essential fields
    );
    
    if (invalidMessages.length > 0) {
      console.error('[emailService] Found messages missing required fields:', 
        invalidMessages.map((msg: { id?: string, threadId?: string }) => ({ id: msg.id, threadId: msg.threadId }))
      );
      throw new Error(`Found ${invalidMessages.length} messages missing required fields`);
    }
    
    // Clear existing store
    const oldCount = Object.keys(emailStore).length;
    const oldStore = { ...emailStore }; // Backup in case of error
    emailStore = {};
    console.log(`[emailService] Cleared store (had ${oldCount} threads)`);
    
    try {
      // Group messages by thread ID
      let processedThreads = 0;
      let processedMessages = 0;
      const threadIds = new Set<string>();
      
      data.messages.forEach((message: EmailMessage) => {
        if (!emailStore[message.threadId]) {
          emailStore[message.threadId] = [];
          processedThreads++;
          threadIds.add(message.threadId);
        }
        emailStore[message.threadId].push(message);
        processedMessages++;
      });
      
      lastSyncTime = new Date();
      const duration = Date.now() - startTime;
      
      console.log('[emailService] Email sync completed:', {
        threads: processedThreads,
        messages: processedMessages,
        duration: `${duration}ms`,
        storeSize: Object.keys(emailStore).length,
        threadIds: Array.from(threadIds)
      });
    } catch (error) {
      // Restore old store if processing fails
      emailStore = oldStore;
      throw error;
    }
  } catch (error) {
    console.error('[emailService] Error syncing emails:', error);
    lastSyncError = error instanceof Error ? error : new Error(String(error));
    throw error;
  } finally {
    isSyncing = false;
  }
}

async function fetchSingleThread(threadId: string): Promise<EmailMessage[] | null> {
  try {
    console.log('[emailService] Fetching single thread:', threadId);
    const response = await fetchWithRetry(`/api/google/gmail/thread?threadId=${encodeURIComponent(threadId)}`);
    
    if (!response.ok) {
      console.error('[emailService] Failed to fetch single thread:', {
        status: response.status,
        statusText: response.statusText
      });
      return null;
    }
    
    const data = await response.json();
    if (!data.messages || !Array.isArray(data.messages)) {
      console.error('[emailService] Invalid thread response format:', data);
      return null;
    }
    
    return data.messages;
  } catch (error) {
    console.error('[emailService] Error fetching single thread:', error);
    return null;
  }
}

export async function fetchEmailThread(threadId: string): Promise<EmailThread | null> {
  try {
    console.log('[emailService] Fetching thread:', threadId);
    
    // Check if thread exists in store
    if (emailStore[threadId] && Array.isArray(emailStore[threadId])) {
      const messages = emailStore[threadId] as EmailMessage[];
      
      // If any message in the thread isn't fully loaded, fetch the full content
      const needsFullContent = messages.some((msg: EmailMessage) => !msg.isFullyLoaded);
      
      if (needsFullContent) {
        console.log('[emailService] Thread found but needs full content:', threadId);
        const fullThread = await fetchSingleThread(threadId);
        if (fullThread) {
          emailStore[threadId] = fullThread;
          return { messages: fullThread };
        }
      } else {
        console.log('[emailService] Found fully loaded thread in store:', {
          threadId,
          messageCount: messages.length
        });
        return { messages };
      }
    }
    
    // If store is empty or outdated, force a sync
    if (Object.keys(emailStore).length === 0 || !lastSyncTime || Date.now() - lastSyncTime.getTime() > 5 * 60 * 1000) {
      console.log('[emailService] Store empty or outdated, forcing sync...');
      await syncEmails(true);
      
      // Check again after sync
      if (emailStore[threadId] && Array.isArray(emailStore[threadId])) {
        const messages = emailStore[threadId] as EmailMessage[];
        console.log('[emailService] Found thread in store after sync:', {
          threadId,
          messageCount: messages.length
        });
        return {
          messages
        };
      }
    }
    
    // If thread still not found, try fetching it directly
    console.log('[emailService] Thread not in store, attempting direct fetch:', threadId);
    const messages = await fetchSingleThread(threadId);
    
    if (messages) {
      // Add to store for future use
      emailStore[threadId] = messages;
      console.log('[emailService] Successfully fetched thread directly:', {
        threadId,
        messageCount: messages.length
      });
      return { messages };
    }
    
    console.error('[emailService] Thread not found in store or via direct fetch:', {
      threadId,
      storeSize: Object.keys(emailStore).length,
      lastSync: lastSyncTime?.toISOString()
    });
    return null;
  } catch (error) {
    console.error('[emailService] Error fetching email thread:', error);
    return null;
  }
}

export async function createEmailDraft(threadId: string, content: string): Promise<boolean> {
  try {
    const response = await fetchWithRetry('/api/google/gmail/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId, content }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    return data.success || false;
  } catch (error) {
    console.error('[emailService] Error creating email draft:', error);
    return false;
  }
}

export function formatEmailThread(thread: EmailThread): string {
  let formattedContent = '\n\nREQUESTED EMAIL THREAD:\n' + '='.repeat(50) + '\n';
  
  // Sort messages by date
  const sortedMessages = [...thread.messages].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  sortedMessages.forEach((message, index) => {
    formattedContent += `\nMessage ${index + 1}:\n`;
    formattedContent += `From: ${message.from}\n`;
    formattedContent += `Date: ${new Date(message.date).toLocaleString()}\n`;
    formattedContent += `Subject: ${message.subject}\n\n`;
    formattedContent += `${message.body?.trim() || '(no content)'}\n`;
    formattedContent += '\n' + '-'.repeat(50) + '\n';
  });

  return formattedContent;
} 