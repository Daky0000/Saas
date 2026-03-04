import express, { type Request, type Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import jwt from 'jsonwebtoken';

dotenv.config();

const app = express();
const PORT = process.env.BACKEND_PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Middleware
app.use(cors({
  origin: process.env.VITE_APP_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());

// Types
interface OAuthState {
  platform: string;
  userId: string;
  code: string;
  state: string;
}

// OAuth Handler for Instagram
app.post('/api/oauth/callback', async (req: Request, res: Response) => {
  try {
    const { platform, code, state } = req.body;

    if (!code || !state) {
      return res.status(400).json({ success: false, error: 'Missing code or state' });
    }

    // Validate state to prevent CSRF
    const storedState = getStoredState(state);
    if (!storedState) {
      return res.status(400).json({ success: false, error: 'Invalid state parameter' });
    }

    let tokenData;

    switch (platform) {
      case 'Instagram':
        tokenData = await exchangeInstagramCode(code);
        break;
      case 'Twitter':
        tokenData = await exchangeTwitterCode(code);
        break;
      case 'LinkedIn':
        tokenData = await exchangeLinkedInCode(code);
        break;
      case 'Facebook':
        tokenData = await exchangeFacebookCode(code);
        break;
      case 'TikTok':
        tokenData = await exchangeTikTokCode(code);
        break;
      default:
        return res.status(400).json({ success: false, error: 'Unsupported platform' });
    }

    // Store user connection in database
    const userId = getUserIdFromRequest(req);
    await storeUserConnection(userId, platform, tokenData);

    return res.json({ success: true, data: tokenData });
  } catch (error) {
    console.error('OAuth callback error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'OAuth callback failed' 
    });
  }
});

// Get connected accounts
app.get('/api/accounts', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromRequest(req);
    const accounts = await getUserConnectedAccounts(userId);
    return res.json({ success: true, data: accounts });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to fetch accounts' });
  }
});

// Disconnect account
app.delete('/api/accounts/:platform', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromRequest(req);
    const { platform } = req.params;
    await removeUserConnection(userId, platform);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to disconnect' });
  }
});

// Test connection
app.get('/api/accounts/:platform/test', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromRequest(req);
    const { platform } = req.params;
    const result = await testPlatformConnection(userId, platform);
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Connection test failed' });
  }
});

// Publish post
app.post('/api/posts/:platform/publish', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromRequest(req);
    const { platform } = req.params;
    const { text, media, hashtags } = req.body;

    const result = await publishToPlatform(userId, platform, {
      text,
      media,
      hashtags,
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to publish post' });
  }
});

// Get analytics
app.get('/api/analytics/:platform', async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromRequest(req);
    const { platform } = req.params;
    const analytics = await getPlatformAnalytics(userId, platform);
    return res.json({ success: true, data: analytics });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
  }
});

// OAuth Exchange Functions
async function exchangeInstagramCode(code: string) {
  const data = new URLSearchParams({
    client_id: process.env.VITE_INSTAGRAM_APP_ID || '',
    client_secret: process.env.INSTAGRAM_APP_SECRET || '',
    grant_type: 'authorization_code',
    redirect_uri: process.env.VITE_INSTAGRAM_REDIRECT_URI || '',
    code,
  });

  const response = await axios.post('https://graph.instagram.com/v18.0/oauth/access_token', data);
  return response.data;
}

async function exchangeTwitterCode(code: string) {
  const response = await axios.post('https://api.twitter.com/2/oauth2/token', {
    client_id: process.env.VITE_TWITTER_CLIENT_ID,
    client_secret: process.env.TWITTER_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: process.env.VITE_TWITTER_REDIRECT_URI,
    code_verifier: 'challenge', // Add proper PKCE verification
  });
  return response.data;
}

async function exchangeLinkedInCode(code: string) {
  const response = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', {
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.VITE_LINKEDIN_REDIRECT_URI,
    client_id: process.env.VITE_LINKEDIN_CLIENT_ID,
    client_secret: process.env.LINKEDIN_CLIENT_SECRET,
  });
  return response.data;
}

async function exchangeFacebookCode(code: string) {
  const response = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
    params: {
      client_id: process.env.VITE_FACEBOOK_APP_ID,
      client_secret: process.env.FACEBOOK_APP_SECRET,
      redirect_uri: process.env.VITE_FACEBOOK_REDIRECT_URI,
      code,
    },
  });
  return response.data;
}

async function exchangeTikTokCode(code: string) {
  const response = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', {
    client_key: process.env.VITE_TIKTOK_CLIENT_ID,
    client_secret: process.env.TIKTOK_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: process.env.VITE_TIKTOK_REDIRECT_URI,
  });
  return response.data;
}

// Database/Storage Functions (implement with your database)
function getStoredState(state: string): boolean {
  // Implement state validation from storage
  return true;
}

function getUserIdFromRequest(req: Request): string {
  // Extract user ID from JWT token or session
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      return decoded.userId;
    } catch (e) {
      // Handle token validation error
    }
  }
  return 'default-user'; // Replace with proper auth
}

async function storeUserConnection(
  userId: string,
  platform: string,
  tokenData: any
): Promise<void> {
  // Implement storing connection in database
  console.log(`Storing connection for user ${userId} on ${platform}`);
}

async function getUserConnectedAccounts(userId: string): Promise<any[]> {
  // Implement fetching accounts from database
  return [];
}

async function removeUserConnection(userId: string, platform: string): Promise<void> {
  // Implement removing connection from database
  console.log(`Removing connection for user ${userId} on ${platform}`);
}

async function testPlatformConnection(userId: string, platform: string): Promise<any> {
  // Implement testing connection
  return { status: 'ok', platform };
}

async function publishToPlatform(
  userId: string,
  platform: string,
  content: any
): Promise<any> {
  // Implement publishing to platform
  return { postId: 'test', platform };
}

async function getPlatformAnalytics(userId: string, platform: string): Promise<any> {
  // Implement fetching analytics
  return { platform, followers: 0, engagement: 0 };
}

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root route
app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'OAuth Backend Server Running ✓', version: '1.0.0' });
});

// Start server
app.listen(PORT, () => {
  console.log(`OAuth server running on port ${PORT}`);
});

export default app;
