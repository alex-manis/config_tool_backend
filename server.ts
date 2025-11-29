import express from "express";
import cors from "cors";
import path from "path";
import type { PublisherListItem } from "./types/interfaces.js";
import { fileURLToPath } from "url";
import fs from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
const PORT = process.env.PORT || 3001;

// Get allowed origins from environment or use defaults
const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',')
    : [
        "http://localhost:3000",
        "https://localhost:3000",
        // Add your GitHub Pages URL here (e.g., "https://username.github.io")
        // Or set ALLOWED_ORIGINS environment variable on Render
      ];

// Enable CORS for frontend
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            // For development, allow all origins
            if (process.env.NODE_ENV !== 'production') {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        }
    },
    credentials: true,
}));

// Parse JSON bodies
app.use(express.json());

// API endpoint to get publishers list
app.get("/api/publishers", async (_req, res) => {
    try {
        const dataPath = path.join(__dirname, "./data/publishers.json");
        const data = await fs.readFile(dataPath, "utf-8");
        res.json(JSON.parse(data));
    } catch (error) {
        res.status(500).json({ error: "Failed to read publishers data" });
    }
});

// API endpoint to get a specific publisher config
app.get("/api/publisher/:filename", async (req, res) => {
    try {
        const { filename } = req.params;
        const dataPath = path.join(__dirname, "./data", filename);
        const data = await fs.readFile(dataPath, "utf-8");
        res.json(JSON.parse(data));
    } catch (error) {
        res.status(404).json({ error: "Publisher config not found" });
    }
});

// API endpoint to update a publisher config
app.put("/api/publisher/:filename", async (req, res) => {
    try {
        const { filename } = req.params;
        const dataPath = path.join(__dirname, "./data", filename);

        await fs.writeFile(dataPath, JSON.stringify(req.body, null, 2), "utf-8");

        const publishersListPath = path.join(__dirname, "./data/publishers.json");
        const publishersListData = await fs.readFile(publishersListPath, "utf-8");
        const publishersList = JSON.parse(publishersListData);

        const publisherIndex = publishersList.publishers.findIndex((p: PublisherListItem) => p.file === filename);
        if (publisherIndex !== -1) {
            publishersList.publishers[publisherIndex].alias = req.body.aliasName;
        }

        publishersList.publishers.sort((a: PublisherListItem, b: PublisherListItem) => a.alias.localeCompare(b.alias));
        await fs.writeFile(publishersListPath, JSON.stringify(publishersList, null, 2), "utf-8");

        res.json({ success: true, filename });
    } catch (error) {
        console.error("Error updating publisher:", error);
        res.status(500).json({ error: "Failed to save publisher config" });
    }
});

// API endpoint to create a publisher config
app.post("/api/publisher/:filename", async (req, res) => {
    try {
        const { filename } = req.params;
        const dataPath = path.join(__dirname, "./data", filename);

        await fs.writeFile(dataPath, JSON.stringify(req.body, null, 2), "utf-8");

        const publishersListPath = path.join(__dirname, "./data/publishers.json");
        const publishersListData = await fs.readFile(publishersListPath, "utf-8");
        const publishersList = JSON.parse(publishersListData);

        publishersList.publishers.push({
            id: req.body.publisherId,
            alias: req.body.aliasName,
            file: filename,
        });

        publishersList.publishers.sort((a: PublisherListItem, b: PublisherListItem) => a.alias.localeCompare(b.alias));
        await fs.writeFile(publishersListPath, JSON.stringify(publishersList, null, 2), "utf-8");

        res.status(201).json({ success: true, filename });
    } catch (error) {
        console.error("Error creating publisher:", error);
        res.status(500).json({ error: "Failed to create publisher config" });
    }
});

// API endpoint to delete a publisher config
app.delete("/api/publisher/:filename", async (req, res) => {
    try {
        const { filename } = req.params;
        const dataPath = path.join(__dirname, "./data", filename);
        const publishersListPath = path.join(__dirname, "./data/publishers.json");

        await fs.unlink(dataPath);
        const publishersListData = await fs.readFile(publishersListPath, "utf-8");
        const publishersList = JSON.parse(publishersListData);

        publishersList.publishers = publishersList.publishers.filter((p: PublisherListItem) => p.file !== filename);

        await fs.writeFile(publishersListPath, JSON.stringify(publishersList, null, 2), "utf-8");

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Failed to delete publisher config" });
    }
});

// Health check endpoint
app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});

// Start the server
if (process.env.NODE_ENV !== "test") {
    app.listen(PORT, () => {
        console.log(`Backend API server running at http://localhost:${PORT}`);
        console.log(`CORS enabled for: ${FRONTEND_URL}`);
    });
}

