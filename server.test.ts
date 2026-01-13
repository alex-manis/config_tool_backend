import request from "supertest";
import fs from "fs/promises";
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { app } from "./server.js";

jest.mock("fs/promises");

const mockedFs = fs as jest.Mocked<typeof fs>;

mockedFs.readFile = jest.fn();
mockedFs.writeFile = jest.fn();
mockedFs.unlink = jest.fn();
mockedFs.access = jest.fn();

// API key for testing
const TEST_API_KEY = "your-internal-api-key";

// Helper to add API key to requests
const withApiKey = (req: request.Test) => req.set("x-api-key", TEST_API_KEY);

describe("Server API", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // Mock fs.access to simulate file existence/non-existence
    (mockedFs.access as jest.Mock).mockRejectedValue(new Error("ENOENT"));
  });

  describe("GET /api/publishers", () => {
    it("should return a list of publishers", async () => {
      const publishers = { publishers: [{ id: "pub-1", alias: "Publisher 1", file: "pub1.json" }] };
      mockedFs.readFile.mockResolvedValue(JSON.stringify(publishers));

      const response = await withApiKey(request(app).get("/api/publishers"));

      expect(response.status).toBe(200);
      expect(response.body).toEqual(publishers);
    });

    it("should return 401 without API key", async () => {
      const response = await request(app).get("/api/publishers");
      expect(response.status).toBe(401);
    });

    it("should return 500 on file read error", async () => {
      mockedFs.readFile.mockRejectedValue(new Error("File not found"));

      const response = await withApiKey(request(app).get("/api/publishers"));

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Failed to read publishers data" });
    });
  });

  describe("GET /api/publisher/:filename", () => {
    it("should return a single publisher config", async () => {
      const publisherConfig = { publisherId: "pub-test", aliasName: "Test Publisher" };
      mockedFs.readFile.mockResolvedValue(JSON.stringify(publisherConfig));

      const response = await withApiKey(request(app).get("/api/publisher/test.json"));

      expect(response.status).toBe(200);
      expect(response.body).toEqual(publisherConfig);
    });

    it("should return 400 for invalid filename", async () => {
      const response = await withApiKey(request(app).get("/api/publisher/../../../etc/passwd"));
      expect(response.status).toBe(400);
    });

    it("should return 404 if publisher not found", async () => {
      mockedFs.readFile.mockRejectedValue(new Error("ENOENT"));

      const response = await withApiKey(request(app).get("/api/publisher/not-found.json"));

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Publisher config not found" });
    });
  });

  describe("PUT /api/publisher/:filename (update)", () => {
    it("should update a publisher config and the main list, then return success", async () => {
      const updatedConfig = { 
        publisherId: "existing-pub", 
        aliasName: "Updated Publisher Name",
        isActive: true,
        pages: []
      };
      const initialPublishers = {
        publishers: [
          { id: "existing-pub", alias: "Old Publisher Name", file: "existing.json" },
          { id: "another-pub", alias: "Another Publisher", file: "another.json" },
        ],
      };

      mockedFs.readFile.mockResolvedValueOnce(JSON.stringify(initialPublishers));
      mockedFs.writeFile.mockResolvedValue();

      const response = await withApiKey(request(app)
        .put("/api/publisher/existing.json")
        .send(updatedConfig));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, filename: "existing.json" });
      expect(mockedFs.writeFile).toHaveBeenCalledTimes(2); // Должен записать и файл паблишера, и список
      expect(mockedFs.writeFile).toHaveBeenCalledWith(expect.stringContaining("existing.json"), JSON.stringify(updatedConfig, null, 2), "utf-8");

      const writtenPublishersList = JSON.parse(mockedFs.writeFile.mock.calls[1][1] as string);
      expect(writtenPublishersList.publishers[1].alias).toBe("Updated Publisher Name");
      expect(writtenPublishersList.publishers[0].alias).toBe("Another Publisher"); // Проверяем сортировку
    });

    it("should return 400 for invalid data", async () => {
      const invalidConfig = { publisherId: "", aliasName: "Test" };
      const response = await withApiKey(request(app)
        .put("/api/publisher/test.json")
        .send(invalidConfig));
      expect(response.status).toBe(400);
    });
  });

  describe("POST /api/publisher/:filename (create)", () => {
    it("should create a new publisher file and update the list", async () => {
      const newConfig = { 
        publisherId: "new-pub", 
        aliasName: "New Publisher",
        isActive: true,
        pages: []
      };
      const initialPublishers = { publishers: [{ id: "old-pub", alias: "Old Publisher", file: "old.json" }] };

      mockedFs.readFile.mockResolvedValueOnce(JSON.stringify(initialPublishers));
      mockedFs.writeFile.mockResolvedValue();
      // File doesn't exist (access fails)
      mockedFs.access.mockRejectedValue(new Error("ENOENT"));

      const response = await withApiKey(request(app)
        .post("/api/publisher/new.json")
        .send(newConfig));

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ success: true, filename: "new.json" });
      expect(mockedFs.writeFile).toHaveBeenCalledTimes(2);

      expect(mockedFs.writeFile).toHaveBeenCalledWith(expect.stringContaining("new.json"), JSON.stringify(newConfig, null, 2), "utf-8");

      const expectedPublishers = {
        publishers: [
          { id: "new-pub", alias: "New Publisher", file: "new.json" },
          { id: "old-pub", alias: "Old Publisher", file: "old.json" }
        ]
      };
      expect(mockedFs.writeFile).toHaveBeenCalledWith(expect.stringContaining("publishers.json"), JSON.stringify(expectedPublishers, null, 2), "utf-8");

    });
  });

  describe("DELETE /api/publisher/:filename", () => {
    it("should delete a publisher file and update the list", async () => {
      const initialPublishers = { publishers: [{ file: "test.json" }, { file: "to-delete.json" }] };
      mockedFs.readFile.mockResolvedValue(JSON.stringify(initialPublishers));
      mockedFs.unlink.mockResolvedValue();
      mockedFs.writeFile.mockResolvedValue();

      const response = await withApiKey(request(app).delete("/api/publisher/to-delete.json"));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(mockedFs.unlink).toHaveBeenCalledWith(expect.stringContaining("to-delete.json"));
      expect(mockedFs.writeFile).toHaveBeenCalledWith(expect.stringContaining("publishers.json"), JSON.stringify({ publishers: [{ file: "test.json" }] }, null, 2), "utf-8");
    });
  });

  describe("GET /health", () => {
    it("should return health status", async () => {
      mockedFs.access.mockResolvedValue(undefined);
      const response = await request(app).get("/health");
      expect(response.status).toBe(200);
      expect(response.body.status).toBe("ok");
    });
  });
});
