import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AppSyncEvent } from "../../types/appsync";
import type { Customer } from "../../types/models";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@db/client", () => ({
  getItem: vi.fn(),
  putItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  queryItems: vi.fn(),
  decodeNextToken: vi.fn(),
  TABLE_NAME: "test-table",
  entityKeys: {
    customer: {
      pk: (id: string) => `CUSTOMER#${id}`,
      sk: () => "METADATA",
      gsi1pk: (status: string) => `CUSTOMER#${status}`,
      gsi1sk: (createdAt: string) => createdAt,
    },
  },
}));

vi.mock("@log", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("@error", () => ({
  throwError: vi.fn((msg: string) => {
    throw new Error(msg);
  }),
}));

vi.mock("ulid", () => ({ ulid: () => "01JTEST000000000000000000" }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockEvent = <T>(args: T): AppSyncEvent<T> =>
  ({
    typeName: "Query",
    fieldName: "test",
    arguments: args,
    identity: { sub: "user-123", username: "test@test.com" } as AppSyncEvent<T>["identity"],
    source: null,
    request: { headers: {}, domainName: null },
    info: { fieldName: "test", parentTypeName: "Query", variables: {}, selectionSetList: [], selectionSetGraphQL: "" },
  }) as AppSyncEvent<T>;

const mockCustomer: Customer = {
  id: "01JTEST000000000000000000",
  rut: "12345678-9",
  companyName: "Test SA",
  email: "test@test.com",
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  createdBy: "user-123",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Customer resolvers", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("getCustomer", () => {
    it("returns null when customer does not exist", async () => {
      const { getItem } = await import("@db/client");
      vi.mocked(getItem).mockResolvedValueOnce(null);

      const { getCustomer } = await import("./handler");
      const result = await getCustomer(mockEvent({ id: "non-existent" }));

      expect(result).toBeNull();
      expect(getItem).toHaveBeenCalledWith("CUSTOMER#non-existent", "METADATA");
    });

    it("returns customer when it exists", async () => {
      const { getItem } = await import("@db/client");
      vi.mocked(getItem).mockResolvedValueOnce({
        ...mockCustomer,
        PK: "CUSTOMER#01JTEST000000000000000000",
        SK: "METADATA",
        GSI1PK: "CUSTOMER#ACTIVE",
        GSI1SK: mockCustomer.createdAt,
        entityType: "CUSTOMER",
      });

      const { getCustomer } = await import("./handler");
      const result = await getCustomer(mockEvent({ id: "01JTEST000000000000000000" }));

      expect(result).not.toBeNull();
      expect(result?.companyName).toBe("Test SA");
      expect(result).not.toHaveProperty("PK");
      expect(result).not.toHaveProperty("entityType");
    });
  });

  describe("createCustomer", () => {
    it("creates customer and returns domain object without DB keys", async () => {
      const { putItem } = await import("@db/client");
      vi.mocked(putItem).mockResolvedValueOnce({});

      const { createCustomer } = await import("./handler");
      const result = await createCustomer(
        mockEvent({
          input: {
            rut: "12345678-9",
            companyName: "Nueva SA",
            email: "nueva@test.com",
          },
        })
      );

      expect(putItem).toHaveBeenCalledOnce();
      expect(result.status).toBe("ACTIVE");
      expect(result.companyName).toBe("Nueva SA");
      expect(result.createdBy).toBe("user-123");
      expect(result).not.toHaveProperty("PK");
    });
  });

  describe("deleteCustomer", () => {
    it("returns the deleted id", async () => {
      const { deleteItem } = await import("@db/client");
      vi.mocked(deleteItem).mockResolvedValueOnce(undefined);

      const { deleteCustomer } = await import("./handler");
      const result = await deleteCustomer(mockEvent({ id: "01JTEST000000000000000000" }));

      expect(result).toBe("01JTEST000000000000000000");
    });
  });
});
