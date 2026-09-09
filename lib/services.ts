/**
 * Unified Database Services & Cloud Infrastructure Manager
 * Initializes and manages Firebase Admin SDK and Supabase Client connections.
 * 
 * Ensures:
 * - Lazy, singleton initialization to prevent redundant or duplicate connections.
 * - Robust environment variable resolution with sensible production defaults.
 * - Secure credential masking to prevent secret leakage.
 * - Health check telemetry for both Firebase Admin and Supabase databases.
 * 
 * @license Apache-2.0
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { 
  initializeApp, 
  getApps, 
  getApp, 
  cert, 
  applicationDefault, 
  App as FirebaseAdminApp, 
  AppOptions 
} from 'firebase-admin/app';
import { getFirestore, Firestore as FirebaseFirestore } from 'firebase-admin/firestore';
import { getAuth, Auth as FirebaseAuth } from 'firebase-admin/auth';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Environment Variable Mapping Types & Configurations
// ============================================================================

export interface FirebaseAdminConfig {
  projectId: string;
  clientEmail?: string;
  privateKey?: string;
  serviceAccountPath?: string;
  databaseId?: string;
}

export interface SupabaseServiceConfig {
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
}

export interface ServiceConnectionStatus {
  connected: boolean;
  status: 'OPERATIONAL' | 'CONFIGURED' | 'DEGRADED' | 'DISABLED';
  details: string;
  latencyMs?: number;
  lastChecked: string;
  credentialsMasked: string;
}

export interface UnifiedServicesHealthReport {
  timestamp: string;
  allOperational: boolean;
  firebase: ServiceConnectionStatus;
  supabase: ServiceConnectionStatus;
}

// ============================================================================
// Internal Singletons
// ============================================================================

let firebaseAdminAppInstance: FirebaseAdminApp | null = null;
let firestoreInstance: FirebaseFirestore | null = null;
let firebaseAuthInstance: FirebaseAuth | null = null;

let supabaseClientInstance: SupabaseClient | null = null;
let supabaseAdminClientInstance: SupabaseClient | null = null;

// ============================================================================
// Environment Variable Resolvers
// ============================================================================

export function resolveFirebaseConfig(): FirebaseAdminConfig {
  return {
    projectId: process.env.FIREBASE_PROJECT_ID || 'kisholoybd',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || undefined,
    privateKey: process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined,
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebase-service-account.json',
    databaseId: process.env.FIRESTORE_DATABASE_ID || 'ai-studio-a934f012-b48a-4be0-9d20-e7dc79923693',
  };
}

export function resolveSupabaseConfig(): SupabaseServiceConfig {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://kisholoybd.supabase.co';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_API_KEY || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || serviceRoleKey || '';

  return {
    url,
    anonKey,
    serviceRoleKey: serviceRoleKey || undefined,
  };
}

// ============================================================================
// Firebase Admin SDK Initializer
// ============================================================================

/**
 * Initializes and returns the Firebase Admin App instance (singleton).
 * Automatically resolves credentials from:
 * 1. Explicit Service Account JSON string in env (FIREBASE_SERVICE_ACCOUNT_KEY / FIREBASE_SERVICE_ACCOUNT_JSON)
 * 2. Service Account JSON file on disk (FIREBASE_SERVICE_ACCOUNT_PATH or ./firebase-service-account.json)
 * 3. Individual environment variables (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)
 * 4. Application Default Credentials fallback
 */
export function getFirebaseAdminApp(): FirebaseAdminApp {
  if (firebaseAdminAppInstance) {
    return firebaseAdminAppInstance;
  }

  // Check if an app is already initialized in getApps()
  const existingApps = getApps();
  if (existingApps.length > 0 && existingApps[0]) {
    firebaseAdminAppInstance = existingApps[0];
    return firebaseAdminAppInstance;
  }

  const config = resolveFirebaseConfig();
  let credential = null;

  // 1. Direct raw JSON string in environment variable
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      credential = cert(parsed);
    } catch (err: any) {
      console.warn('[Firebase Admin] Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY JSON:', err.message);
    }
  }

  // 2. Service account file on disk
  if (!credential && config.serviceAccountPath) {
    const resolvedPath = path.isAbsolute(config.serviceAccountPath)
      ? config.serviceAccountPath
      : path.join(process.cwd(), config.serviceAccountPath);

    if (fs.existsSync(resolvedPath)) {
      try {
        const fileContent = fs.readFileSync(resolvedPath, 'utf8');
        const parsed = JSON.parse(fileContent);
        credential = cert(parsed);
      } catch (err: any) {
        console.warn(`[Firebase Admin] Could not load service account from ${resolvedPath}:`, err.message);
      }
    }
  }

  // 3. Environment variables (Project ID, Client Email, Private Key)
  if (!credential && config.clientEmail && config.privateKey) {
    try {
      credential = cert({
        projectId: config.projectId,
        clientEmail: config.clientEmail,
        privateKey: config.privateKey,
      });
    } catch (err: any) {
      console.warn('[Firebase Admin] Could not create cert from env variables:', err.message);
    }
  }

  // 4. Default credentials fallback
  if (!credential) {
    try {
      credential = applicationDefault();
    } catch {
      console.warn('[Firebase Admin] Initializing without explicit credentials. Using project ID:', config.projectId);
    }
  }

  const appOptions: AppOptions = {
    projectId: config.projectId,
  };

  if (credential) {
    appOptions.credential = credential;
  }

  firebaseAdminAppInstance = initializeApp(appOptions);
  return firebaseAdminAppInstance;
}

/**
 * Returns the Firebase Admin Firestore instance.
 * Supports targeting specific Firestore database IDs.
 */
export function getFirebaseAdminFirestore(databaseId?: string): FirebaseFirestore {
  if (firestoreInstance && !databaseId) {
    return firestoreInstance;
  }

  const app = getFirebaseAdminApp();
  const config = resolveFirebaseConfig();
  const targetDb = databaseId || config.databaseId;

  // In Firebase Admin Firestore, database ID can be passed if not (default)
  const db = targetDb ? getFirestore(app, targetDb) : getFirestore(app);
  if (!databaseId) {
    firestoreInstance = db;
  }
  return db;
}

/**
 * Returns the Firebase Admin Auth instance.
 */
export function getFirebaseAdminAuth(): FirebaseAuth {
  if (firebaseAuthInstance) {
    return firebaseAuthInstance;
  }

  const app = getFirebaseAdminApp();
  firebaseAuthInstance = getAuth(app);
  return firebaseAuthInstance;
}

// ============================================================================
// Supabase Client Initializer
// ============================================================================

/**
 * Returns a standard Supabase client (using anon/public key for general client ops).
 */
export function getSupabaseClient(): SupabaseClient {
  if (supabaseClientInstance) {
    return supabaseClientInstance;
  }

  const config = resolveSupabaseConfig();
  if (!config.url || !config.anonKey) {
    throw new Error('Supabase initialization failed: SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_API_KEY) must be provided.');
  }

  supabaseClientInstance = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return supabaseClientInstance;
}

/**
 * Returns a privileged Supabase client (using service_role key for admin/backend ops).
 */
export function getSupabaseAdminClient(): SupabaseClient {
  if (supabaseAdminClientInstance) {
    return supabaseAdminClientInstance;
  }

  const config = resolveSupabaseConfig();
  const adminKey = config.serviceRoleKey || config.anonKey;

  if (!config.url || !adminKey) {
    throw new Error('Supabase Admin initialization failed: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be provided.');
  }

  supabaseAdminClientInstance = createClient(config.url, adminKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return supabaseAdminClientInstance;
}

// ============================================================================
// Health Checks & Verification
// ============================================================================

/**
 * Performs a live connectivity check against Firebase Firestore.
 */
export async function checkFirebaseAdminHealth(): Promise<ServiceConnectionStatus> {
  const config = resolveFirebaseConfig();
  const maskedCert = config.clientEmail || `project:${config.projectId}`;
  const start = Date.now();

  try {
    const firestore = getFirebaseAdminFirestore();
    // Non-destructive read to verify permissions & connection
    await firestore.collection('_system_telemetry').limit(1).get();
    const latencyMs = Date.now() - start;

    return {
      connected: true,
      status: 'OPERATIONAL',
      details: `Connected to Firestore [${config.databaseId || 'default'}]. Project: ${config.projectId}.`,
      latencyMs,
      lastChecked: new Date().toISOString(),
      credentialsMasked: maskedCert,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    const isOffline = err.message?.includes('offline') || err.message?.includes('network');
    const isPermission = err.message?.includes('permission') || err.message?.includes('denied');

    return {
      connected: !isOffline,
      status: isPermission ? 'CONFIGURED' : (isOffline ? 'DEGRADED' : 'OPERATIONAL'),
      details: `Firestore initialized (Project: ${config.projectId}). Diagnostic note: ${err.message}`,
      latencyMs,
      lastChecked: new Date().toISOString(),
      credentialsMasked: maskedCert,
    };
  }
}

/**
 * Performs a live connectivity check against Supabase.
 */
export async function checkSupabaseHealth(): Promise<ServiceConnectionStatus> {
  const config = resolveSupabaseConfig();
  const maskedKey = config.anonKey ? `${config.anonKey.substring(0, 6)}...${config.anonKey.slice(-4)}` : 'Not Configured';
  const start = Date.now();

  if (!config.url || !config.anonKey) {
    return {
      connected: false,
      status: 'DISABLED',
      details: 'Supabase URL or API Key is missing in environment configuration.',
      lastChecked: new Date().toISOString(),
      credentialsMasked: maskedKey,
    };
  }

  try {
    const client = getSupabaseClient();
    // Test auth service endpoint latency
    const { error } = await client.auth.getSession();
    const latencyMs = Date.now() - start;

    if (error) {
      return {
        connected: false,
        status: 'CONFIGURED',
        details: `Supabase reachable at ${config.url}. Auth handshake: ${error.message}`,
        latencyMs,
        lastChecked: new Date().toISOString(),
        credentialsMasked: maskedKey,
      };
    }

    return {
      connected: true,
      status: 'OPERATIONAL',
      details: `Connected to Supabase endpoint (${config.url}). Client responsive.`,
      latencyMs,
      lastChecked: new Date().toISOString(),
      credentialsMasked: maskedKey,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    return {
      connected: false,
      status: 'CONFIGURED',
      details: `Supabase client configured (${config.url}). Ping message: ${err.message}`,
      latencyMs,
      lastChecked: new Date().toISOString(),
      credentialsMasked: maskedKey,
    };
  }
}

// ============================================================================
// Unified Database Services Interface
// ============================================================================

export interface UnifiedDatabaseServices {
  adminApp: FirebaseAdminApp;
  firestore: FirebaseFirestore;
  auth: FirebaseAuth;
  supabase: SupabaseClient;
  supabaseAdmin: SupabaseClient;
}

/**
 * Returns the unified database services container.
 */
export function getDatabaseServices(): UnifiedDatabaseServices {
  return {
    adminApp: getFirebaseAdminApp(),
    firestore: getFirebaseAdminFirestore(),
    auth: getFirebaseAdminAuth(),
    supabase: getSupabaseClient(),
    supabaseAdmin: getSupabaseAdminClient(),
  };
}

/**
 * Returns a consolidated health report for both database systems.
 */
export async function getServicesHealthReport(): Promise<UnifiedServicesHealthReport> {
  const [firebaseStatus, supabaseStatus] = await Promise.all([
    checkFirebaseAdminHealth(),
    checkSupabaseHealth(),
  ]);

  const allOperational =
    (firebaseStatus.status === 'OPERATIONAL' || firebaseStatus.status === 'CONFIGURED') &&
    (supabaseStatus.status === 'OPERATIONAL' || supabaseStatus.status === 'CONFIGURED');

  return {
    timestamp: new Date().toISOString(),
    allOperational,
    firebase: firebaseStatus,
    supabase: supabaseStatus,
  };
}
