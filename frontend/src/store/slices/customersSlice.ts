import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { generateClient } from "aws-amplify/api";
import { LIST_CUSTOMERS, GET_CUSTOMER } from "@/api/graphql/queries/customers";
import { CREATE_CUSTOMER, UPDATE_CUSTOMER, DELETE_CUSTOMER } from "@/api/graphql/mutations/customers";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Address {
  street: string;
  number: string;
  city: string;
  region: string;
  country: string;
}

interface Customer {
  id: string;
  rut: string;
  companyName: string;
  tradeName?: string;
  email: string;
  phone?: string;
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED" | "PROSPECT";
  elevatorCount?: number;
  address?: Address;
  createdAt: string;
  updatedAt: string;
}

interface CustomersState {
  items: Record<string, Customer>; // id → Customer
  ids: string[];
  nextToken: string | null;
  selectedId: string | null;
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
}

// ─── Async Thunks ─────────────────────────────────────────────────────────────

const client = generateClient();

export const fetchCustomers = createAsyncThunk(
  "customers/fetchAll",
  async (params: { limit?: number; nextToken?: string } = {}) => {
    const response = await client.graphql({
      query: LIST_CUSTOMERS,
      variables: { filter: { limit: params.limit ?? 20, nextToken: params.nextToken } },
    });
    return (response as { data: { listCustomers: { items: Customer[]; nextToken: string | null } } }).data.listCustomers;
  }
);

export const fetchCustomer = createAsyncThunk(
  "customers/fetchOne",
  async (id: string) => {
    const response = await client.graphql({
      query: GET_CUSTOMER,
      variables: { id },
    });
    return (response as { data: { getCustomer: Customer } }).data.getCustomer;
  }
);

export const createCustomer = createAsyncThunk(
  "customers/create",
  async (input: Omit<Customer, "id" | "status" | "createdAt" | "updatedAt">) => {
    const response = await client.graphql({
      query: CREATE_CUSTOMER,
      variables: { input },
    });
    return (response as { data: { createCustomer: Customer } }).data.createCustomer;
  }
);

export const updateCustomer = createAsyncThunk(
  "customers/update",
  async (input: Partial<Customer> & { id: string }) => {
    const response = await client.graphql({
      query: UPDATE_CUSTOMER,
      variables: { input },
    });
    return (response as { data: { updateCustomer: Customer } }).data.updateCustomer;
  }
);

export const deleteCustomer = createAsyncThunk(
  "customers/delete",
  async (id: string) => {
    await client.graphql({ query: DELETE_CUSTOMER, variables: { id } });
    return id;
  }
);

// ─── Slice ────────────────────────────────────────────────────────────────────

const initialState: CustomersState = {
  items: {},
  ids: [],
  nextToken: null,
  selectedId: null,
  status: "idle",
  error: null,
};

export const customersSlice = createSlice({
  name: "customers",
  initialState,
  reducers: {
    setSelected: (state, action: PayloadAction<string | null>) => {
      state.selectedId = action.payload;
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // fetchCustomers
      .addCase(fetchCustomers.pending, (state) => {
        state.status = "loading";
      })
      .addCase(fetchCustomers.fulfilled, (state, action) => {
        state.status = "succeeded";
        action.payload.items.forEach((c) => {
          state.items[c.id] = c;
          if (!state.ids.includes(c.id)) state.ids.push(c.id);
        });
        state.nextToken = action.payload.nextToken;
      })
      .addCase(fetchCustomers.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.error.message ?? "Error loading customers";
      })
      // fetchCustomer
      .addCase(fetchCustomer.fulfilled, (state, action) => {
        if (action.payload) {
          state.items[action.payload.id] = action.payload;
          if (!state.ids.includes(action.payload.id)) {
            state.ids.push(action.payload.id);
          }
        }
      })
      // createCustomer
      .addCase(createCustomer.fulfilled, (state, action) => {
        const c = action.payload;
        state.items[c.id] = c;
        state.ids.unshift(c.id);
      })
      // updateCustomer
      .addCase(updateCustomer.fulfilled, (state, action) => {
        const c = action.payload;
        state.items[c.id] = { ...state.items[c.id], ...c };
      })
      // deleteCustomer
      .addCase(deleteCustomer.fulfilled, (state, action) => {
        const id = action.payload;
        delete state.items[id];
        state.ids = state.ids.filter((i) => i !== id);
        if (state.selectedId === id) state.selectedId = null;
      });
  },
});

export const { setSelected, clearError } = customersSlice.actions;

// ─── Selectors ────────────────────────────────────────────────────────────────

export const selectAllCustomers = (state: { customers: CustomersState }) =>
  state.customers.ids.map((id) => state.customers.items[id]);

export const selectCustomerById = (id: string) => (state: { customers: CustomersState }) =>
  state.customers.items[id];

export const selectCustomersStatus = (state: { customers: CustomersState }) =>
  state.customers.status;

export const selectSelectedCustomer = (state: { customers: CustomersState }) =>
  state.customers.selectedId
    ? state.customers.items[state.customers.selectedId]
    : null;

export default customersSlice.reducer;
