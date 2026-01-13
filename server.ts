import express from "express";
import cors from "cors";
import path from "path";
import type { PublisherListItem, PublisherConfig } from "./types/interfaces.js";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import { appendFile, stat } from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
const PORT = process.env.PORT || 3001;

const FRONTEND_URL = process.env.FRONTEND_URL;
const API_KEY = process.env.API_KEY || "your-internal-api-key";

// Improved CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(o => o !== 'null')
    : process.env.NODE_ENV === 'production'
        ? ["http://internal-company-server:3000"]
        : ["http://localhost:3000", "http://127.0.0.1:3000"];

// Enable CORS for frontend
app.use(cors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // For internal use, allow requests with no origin in development
        if (!origin || process.env.NODE_ENV !== 'production') {
            return callback(null, true);
        }

        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200
}));

// Parse JSON bodies with size limit
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Rate limiting (simple in-memory implementation)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 200; // max requests per window
const MAX_RATE_LIMIT_ENTRIES = 1000; // Maximum entries in rate limit map

function rateLimitMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
    const clientId = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();

    const clientData = rateLimitMap.get(clientId);

    if (!clientData || now > clientData.resetTime) {
        rateLimitMap.set(clientId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });

        // Limit map size to prevent memory leaks
        if (rateLimitMap.size > MAX_RATE_LIMIT_ENTRIES) {
            const entries = Array.from(rateLimitMap.entries());
            entries.sort((a, b) => a[1].resetTime - b[1].resetTime);
            const toDelete = entries.slice(0, rateLimitMap.size - MAX_RATE_LIMIT_ENTRIES + 100);
            toDelete.forEach(([key]) => rateLimitMap.delete(key));
        }

        return next();
    }

    if (clientData.count >= RATE_LIMIT_MAX) {
        return res.status(429).json({ error: "Too many requests, please slow down" });
    }

    clientData.count++;
    next();
}

// Periodic cleanup of expired rate limit entries
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of rateLimitMap.entries()) {
        if (now > value.resetTime) {
            rateLimitMap.delete(key);
        }
    }
}, 5 * 60 * 1000); // Every 5 minutes

// Apply rate limiting to API routes
app.use("/api/", rateLimitMiddleware);

// Simple API key authentication middleware
function authenticateApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
    // Use header first, query parameter only in development
    const apiKey = req.headers["x-api-key"] as string ||
        (process.env.NODE_ENV === "development" ? (req.query.apiKey as string) : undefined);

    if (apiKey === API_KEY) {
        next();
    } else {
        res.status(401).json({ error: "Unauthorized" });
    }
}

// Content-Type validation middleware
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    if ((req.method === "POST" || req.method === "PUT") && req.body && Object.keys(req.body).length > 0) {
        const contentType = req.headers["content-type"];
        if (!contentType || !contentType.includes("application/json")) {
            return res.status(400).json({ error: "Content-Type must be application/json" });
        }
    }
    next();
});

// Apply authentication to API routes (except health check)
app.use("/api/", authenticateApiKey);

// Path traversal protection - validate filename
function validateFilename(filename: string): boolean {
    // Allow only safe filenames: alphanumeric, hyphens, underscores, and .json extension
    if (!/^[a-zA-Z0-9_-]+\.json$/.test(filename)) {
        return false;
    }

    // Check that resolved path is inside data directory
    const resolvedPath = path.resolve(__dirname, "./data", filename);
    const dataDir = path.resolve(__dirname, "./data");

    return resolvedPath.startsWith(dataDir);
}

// Input validation for publisher config
function validatePublisherConfig(data: any): { valid: boolean; error?: string } {
    if (!data || typeof data !== 'object') {
        return { valid: false, error: "Invalid data format" };
    }

    if (!data.publisherId || typeof data.publisherId !== 'string' || data.publisherId.trim() === '') {
        return { valid: false, error: "publisherId is required and must be a non-empty string" };
    }
    if (data.publisherId.length > 100) {
        return { valid: false, error: "publisherId must be 100 characters or less" };
    }

    if (!data.aliasName || typeof data.aliasName !== 'string' || data.aliasName.trim() === '') {
        return { valid: false, error: "aliasName is required and must be a non-empty string" };
    }
    if (data.aliasName.length > 200) {
        return { valid: false, error: "aliasName must be 200 characters or less" };
    }

    if (typeof data.isActive !== 'boolean') {
        return { valid: false, error: "isActive must be a boolean" };
    }

    if (!Array.isArray(data.pages)) {
        return { valid: false, error: "pages must be an array" };
    }

    // Validate structure of pages array
    for (let i = 0; i < data.pages.length; i++) {
        const page = data.pages[i];
        if (!page || typeof page !== 'object') {
            return { valid: false, error: `pages[${i}] must be an object` };
        }
        if (!page.pageType || typeof page.pageType !== 'string') {
            return { valid: false, error: `pages[${i}].pageType is required and must be a string` };
        }
        if (!page.selector || typeof page.selector !== 'string') {
            return { valid: false, error: `pages[${i}].selector is required and must be a string` };
        }
        if (!page.position || typeof page.position !== 'string') {
            return { valid: false, error: `pages[${i}].position is required and must be a string` };
        }
    }

    return { valid: true };
}

// Simple file-based logging with rotation
async function logAction(action: string, details: Record<string, unknown>) {
    try {
        const logPath = path.join(__dirname, "app.log");
        const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

        // Check file size and rotate if needed
        try {
            const stats = await stat(logPath);
            if (stats.size > MAX_LOG_SIZE) {
                // Rotate log file
                const rotatedPath = `${logPath}.${Date.now()}`;
                await fs.rename(logPath, rotatedPath).catch(() => {
                    // Ignore rotation errors
                });
            }
        } catch {
            // File doesn't exist or stat failed, this is normal
        }

        const logEntry = `${new Date().toISOString()} - ${action}: ${JSON.stringify(details)}\n`;
        await appendFile(logPath, logEntry).catch(() => {
            // Ignore logging errors to prevent app crashes
        });
    } catch {
        // Ignore logging errors
    }
}

// Race condition protection - file locks
const fileLocks = new Map<string, Promise<unknown>>();

async function withFileLock<T>(filename: string, operation: () => Promise<T>): Promise<T> {
    // Wait for any existing lock on this file
    if (fileLocks.has(filename)) {
        await fileLocks.get(filename);
    }

    // Create new lock
    const lockPromise = (async () => {
        try {
            return await operation();
        } catch (error) {
            // Re-throw error after ensuring cleanup
            throw error;
        } finally {
            // Guarantee lock removal even on error
            fileLocks.delete(filename);
        }
    })();

    fileLocks.set(filename, lockPromise);
    return lockPromise;
}

// Periodic cleanup of potentially stuck locks (safety measure)
setInterval(() => {
    // Check for locks older than 5 minutes (shouldn't happen, but safety measure)
    const now = Date.now();
    // Note: We can't easily track lock age without modifying the structure
    // This is a safety measure - the finally block should handle cleanup
}, 10 * 60 * 1000); // Every 10 minutes

// Helper function to safely read and parse publishers.json
async function readPublishersList(): Promise<{ publishers: PublisherListItem[] }> {
    const publishersListPath = path.join(__dirname, "./data/publishers.json");
    try {
        const publishersListData = await fs.readFile(publishersListPath, "utf-8");
        let publishersList;
        try {
            publishersList = JSON.parse(publishersListData);
        } catch (parseError) {
            console.error("Failed to parse publishers.json:", parseError);
            await logAction("ERROR", {
                action: "PARSE_PUBLISHERS_JSON",
                error: parseError instanceof Error ? parseError.message : "Unknown parse error"
            });
            throw new Error("Failed to read publishers list - file may be corrupted");
        }

        // Validate structure
        if (!publishersList || !Array.isArray(publishersList.publishers)) {
            console.error("Invalid publishers.json structure");
            await logAction("ERROR", { action: "INVALID_PUBLISHERS_STRUCTURE" });
            throw new Error("Invalid publishers.json structure");
        }

        return publishersList;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        if (errorMessage.includes("corrupted") || errorMessage.includes("Invalid")) {
            throw error;
        }
        // For other errors (like file not found), re-throw
        throw error;
    }
}

// API endpoint to get publishers list
app.get("/api/publishers", async (_req: express.Request, res: express.Response) => {
    try {
        const publishersList = await readPublishersList();
        res.json(publishersList);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        await logAction("ERROR", {
            endpoint: "/api/publishers",
            method: "GET",
            error: errorMessage
        });
        res.status(500).json({
            error: "Failed to read publishers data",
            ...(process.env.NODE_ENV === "development" && { details: errorMessage })
        });
    }
});

// API endpoint to get a specific publisher config
app.get("/api/publisher/:filename", async (req: express.Request, res: express.Response) => {
    try {
        const { filename } = req.params;

        if (!validateFilename(filename)) {
            return res.status(400).json({ error: "Invalid filename" });
        }

        const dataPath = path.join(__dirname, "./data", filename);
        const data = await fs.readFile(dataPath, "utf-8");
        res.json(JSON.parse(data));
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        if (errorMessage.includes("ENOENT")) {
            res.status(404).json({ error: "Publisher config not found" });
        } else {
            const errorStack = error instanceof Error ? error.stack : undefined;
            await logAction("ERROR", {
                endpoint: req.path,
                method: req.method,
                filename: req.params.filename,
                error: errorMessage,
                stack: process.env.NODE_ENV === "development" ? errorStack : undefined
            });

            console.error("Error reading publisher:", errorMessage);
            res.status(500).json({
                error: "Failed to read publisher config",
                ...(process.env.NODE_ENV === "development" && { details: errorMessage })
            });
        }
    }
});

// API endpoint to update a publisher config
app.put("/api/publisher/:filename", async (req: express.Request, res: express.Response) => {
    try {
        const { filename } = req.params;

        if (!validateFilename(filename)) {
            return res.status(400).json({ error: "Invalid filename" });
        }

        const validation = validatePublisherConfig(req.body);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }

        await logAction("UPDATE_PUBLISHER", { filename, publisherId: req.body.publisherId });

        await withFileLock(filename, async () => {
            const dataPath = path.join(__dirname, "./data", filename);
            await fs.writeFile(dataPath, JSON.stringify(req.body, null, 2), "utf-8");

            const publishersList = await readPublishersList();

            const publisherIndex = publishersList.publishers.findIndex((p: PublisherListItem) => p.file === filename);
            if (publisherIndex !== -1) {
                const oldAlias = publishersList.publishers[publisherIndex].alias;
                const newAlias = req.body.aliasName || "";
                publishersList.publishers[publisherIndex].alias = newAlias;

                // Only sort if alias changed
                if (oldAlias !== newAlias) {
                    publishersList.publishers.sort((a: PublisherListItem, b: PublisherListItem) => a.alias.localeCompare(b.alias));
                }
            }

            const publishersListPath = path.join(__dirname, "./data/publishers.json");
            await fs.writeFile(publishersListPath, JSON.stringify(publishersList, null, 2), "utf-8");
        });

        res.json({ success: true, filename });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        const errorStack = error instanceof Error ? error.stack : undefined;

        await logAction("ERROR", {
            endpoint: req.path,
            method: req.method,
            filename: req.params.filename,
            error: errorMessage,
            stack: process.env.NODE_ENV === "development" ? errorStack : undefined
        });

        console.error("Error updating publisher:", errorMessage);
        res.status(500).json({
            error: "Failed to save publisher config",
            ...(process.env.NODE_ENV === "development" && { details: errorMessage })
        });
    }
});

// API endpoint to create a publisher config
app.post("/api/publisher/:filename", async (req: express.Request, res: express.Response) => {
    try {
        const { filename } = req.params;

        if (!validateFilename(filename)) {
            return res.status(400).json({ error: "Invalid filename" });
        }

        const validation = validatePublisherConfig(req.body);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }

        const dataPath = path.join(__dirname, "./data", filename);

        // Check if file already exists before locking
        try {
            await fs.access(dataPath);
            return res.status(409).json({ error: "Publisher config already exists" });
        } catch {
            // File doesn't exist, proceed with creation
        }

        // Check for duplicate publisherId before creating
        const publishersList = await readPublishersList();
        const existingPublisher = publishersList.publishers.find(
            (p: PublisherListItem) => p.id === req.body.publisherId
        );
        if (existingPublisher) {
            return res.status(409).json({
                error: `Publisher with ID "${req.body.publisherId}" already exists in file "${existingPublisher.file}"`
            });
        }

        await logAction("CREATE_PUBLISHER", { filename, publisherId: req.body.publisherId });

        await withFileLock(filename, async () => {
            // Double-check after acquiring lock
            try {
                await fs.access(dataPath);
                throw new Error("Publisher config already exists");
            } catch (err: any) {
                if (err.message === "Publisher config already exists") {
                    throw err;
                }
                // File doesn't exist, proceed
            }

            await fs.writeFile(dataPath, JSON.stringify(req.body, null, 2), "utf-8");

            // Re-read publishers list to ensure we have latest data
            const updatedPublishersList = await readPublishersList();

            updatedPublishersList.publishers.push({
                id: req.body.publisherId,
                alias: req.body.aliasName,
                file: filename,
            });

            updatedPublishersList.publishers.sort((a: PublisherListItem, b: PublisherListItem) => a.alias.localeCompare(b.alias));
            const publishersListPath = path.join(__dirname, "./data/publishers.json");
            await fs.writeFile(publishersListPath, JSON.stringify(updatedPublishersList, null, 2), "utf-8");
        });

        res.status(201).json({ success: true, filename });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        if (errorMessage.includes("already exists")) {
            return res.status(409).json({ error: "Publisher config already exists" });
        }
        const errorStack = error instanceof Error ? error.stack : undefined;
        await logAction("ERROR", {
            endpoint: req.path,
            method: req.method,
            filename: req.params.filename,
            error: errorMessage,
            stack: process.env.NODE_ENV === "development" ? errorStack : undefined
        });

        console.error("Error creating publisher:", errorMessage);
        res.status(500).json({
            error: "Failed to create publisher config",
            ...(process.env.NODE_ENV === "development" && { details: errorMessage })
        });
    }
});

// API endpoint to delete a publisher config
app.delete("/api/publisher/:filename", async (req: express.Request, res: express.Response) => {
    try {
        const { filename } = req.params;

        if (!validateFilename(filename)) {
            return res.status(400).json({ error: "Invalid filename" });
        }

        await logAction("DELETE_PUBLISHER", { filename });

        await withFileLock(filename, async () => {
            const dataPath = path.join(__dirname, "./data", filename);

            await fs.unlink(dataPath);
            const publishersList = await readPublishersList();

            publishersList.publishers = publishersList.publishers.filter((p: PublisherListItem) => p.file !== filename);

            const publishersListPath = path.join(__dirname, "./data/publishers.json");
            await fs.writeFile(publishersListPath, JSON.stringify(publishersList, null, 2), "utf-8");
        });

        res.json({ success: true });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        if (errorMessage.includes("ENOENT")) {
            res.status(404).json({ error: "Publisher config not found" });
        } else {
            const errorStack = error instanceof Error ? error.stack : undefined;
            await logAction("ERROR", {
                endpoint: req.path,
                method: req.method,
                filename: req.params.filename,
                error: errorMessage,
                stack: process.env.NODE_ENV === "development" ? errorStack : undefined
            });

            console.error("Error deleting publisher:", errorMessage);
            res.status(500).json({
                error: "Failed to delete publisher config",
                ...(process.env.NODE_ENV === "development" && { details: errorMessage })
            });
        }
    }
});

// Health check endpoint (public, no authentication required)
app.get("/health", async (_req: express.Request, res: express.Response) => {
    const dataPath = path.join(__dirname, "./data");
    try {
        await fs.access(dataPath);
        res.json({
            status: "ok",
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    } catch {
        res.status(503).json({
            status: "error",
            message: "Data directory not accessible"
        });
    }
});

// Error handler middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Error:", err);
    res.status(500).json({
        error: "Internal server error",
        ...(process.env.NODE_ENV === "development" && { message: err.message })
    });
});

// Start the server
if (process.env.NODE_ENV !== "test") {
    app.listen(PORT, () => {
        console.log(`Backend API server running at http://localhost:${PORT}`);
        console.log(`CORS enabled for: ${FRONTEND_URL}`);
    });
}

