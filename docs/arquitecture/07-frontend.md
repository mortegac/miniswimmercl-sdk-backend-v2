# 07 — Frontend (React + Redux + Vite)

## Stack

```
React 19            → UI components
Redux Toolkit       → estado global
React Router v7     → navegación SPA
aws-amplify v6      → cliente GraphQL + auth
Vite 6              → bundler y dev server
TypeScript 5.8      → type safety
```

## Estructura de carpetas

```
frontend/src/
├── main.tsx                    ← Bootstrap: Amplify.configure + Provider
├── App.tsx                     ← Router + Authenticator
│
├── api/graphql/
│   ├── queries/
│   │   └── customers.ts        ← GET_CUSTOMER, LIST_CUSTOMERS, SEARCH_CUSTOMERS
│   ├── mutations/
│   │   ├── customers.ts        ← CREATE_CUSTOMER, UPDATE_CUSTOMER, DELETE_CUSTOMER
│   │   └── webforms.ts         ← CREATE_WEBFORM, UPDATE_WEBFORM, ASSIGN_WEBFORM
│   └── subscriptions/
│       └── webforms.ts         ← ON_WEBFORM_CREATED, ON_WEBFORM_UPDATED
│
├── store/
│   ├── index.ts                ← configureStore + tipos RootState / AppDispatch
│   ├── slices/
│   │   ├── customersSlice.ts   ← thunks + reducers + selectors
│   │   ├── usersSlice.ts       ← (próximo)
│   │   └── webformsSlice.ts    ← (próximo)
│   └── middleware/             ← (para middleware custom futuro)
│
├── pages/                      ← una carpeta por ruta
│   ├── CustomersPage/
│   ├── WebformsPage/
│   └── UsersPage/
│
├── components/                 ← componentes reutilizables
├── hooks/                      ← custom hooks
└── types/                      ← tipos frontend adicionales
```

## Inicialización (main.tsx)

```typescript
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId:       import.meta.env.VITE_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID,
    },
  },
  API: {
    GraphQL: {
      endpoint:        import.meta.env.VITE_GRAPHQL_ENDPOINT,
      region:          import.meta.env.VITE_AWS_REGION ?? "us-east-1",
      defaultAuthMode: "userPool",  // JWT automático
    },
  },
});

// Árbol de providers
<Provider store={store}>          // Redux
  <Authenticator hideSignUp>      // Cognito UI (sin auto-registro)
    <App />
  </Authenticator>
</Provider>
```

## Variables de entorno

```bash
# frontend/.env.local  (generadas por CDK outputs)
VITE_AWS_REGION=us-east-1
VITE_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_USER_POOL_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_GRAPHQL_ENDPOINT=https://XXXXXXXXXX.appsync-api.us-east-1.amazonaws.com/graphql
```

Copiar desde `frontend/.env.example` y completar con los outputs del CDK deploy.

## Redux — estructura de un slice

Patrón adoptado: **thunks con `createAsyncThunk`** + **normalized state** (items como mapa `id → entidad`).

```typescript
// Normalized state — O(1) para lookup por id
interface CustomersState {
  items: Record<string, Customer>; // id → Customer
  ids:   string[];                 // orden de lista
  nextToken: string | null;        // paginación
  selectedId: string | null;
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
}

// Thunk
export const fetchCustomers = createAsyncThunk(
  "customers/fetchAll",
  async (params) => {
    const response = await client.graphql({
      query: LIST_CUSTOMERS,
      variables: { filter: params },
    });
    return response.data.listCustomers;
  }
);

// Reducer
extraReducers: (builder) => {
  builder
    .addCase(fetchCustomers.pending,   (state) => { state.status = "loading"; })
    .addCase(fetchCustomers.fulfilled, (state, action) => {
      state.status = "succeeded";
      action.payload.items.forEach((c) => {
        state.items[c.id] = c;              // upsert
        if (!state.ids.includes(c.id)) state.ids.push(c.id);
      });
      state.nextToken = action.payload.nextToken;
    })
    .addCase(fetchCustomers.rejected,  (state, action) => {
      state.status = "failed";
      state.error  = action.error.message ?? "Error";
    });
}

// Selectores
export const selectAllCustomers    = (state) => state.customers.ids.map(id => state.customers.items[id]);
export const selectCustomerById    = (id) => (state) => state.customers.items[id];
export const selectCustomersStatus = (state) => state.customers.status;
```

## Hooks tipados (patrón recomendado)

```typescript
// store/index.ts — hooks con tipos correctos
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector = <T>(selector: (state: RootState) => T) => useSelector(selector);

// En componentes — nunca usar useDispatch/useSelector directos
const dispatch  = useAppDispatch();
const customers = useAppSelector(selectAllCustomers);
const status    = useAppSelector(selectCustomersStatus);
```

## Cliente GraphQL (aws-amplify v6)

```typescript
import { generateClient } from "aws-amplify/api";

const client = generateClient();

// Query
const response = await client.graphql({
  query:     LIST_CUSTOMERS,
  variables: { filter: { limit: 20 } },
});

// Mutation
const response = await client.graphql({
  query:     CREATE_CUSTOMER,
  variables: { input: { rut: "...", companyName: "..." } },
});

// Subscription (WebSocket)
const sub = client.graphql({
  query: ON_WEBFORM_CREATED,
}).subscribe({
  next:  ({ data }) => dispatch(webformCreated(data.onWebformCreated)),
  error: (err) => console.error(err),
});

// Limpiar al desmontar
sub.unsubscribe();
```

## Operaciones GraphQL — archivos separados

Cada entidad tiene sus operaciones en archivos separados para facilitar
code splitting y tree-shaking:

```
api/graphql/queries/customers.ts      → GET_CUSTOMER, LIST_CUSTOMERS, SEARCH_CUSTOMERS
api/graphql/mutations/customers.ts    → CREATE_CUSTOMER, UPDATE_CUSTOMER, DELETE_CUSTOMER
api/graphql/mutations/webforms.ts     → CREATE_WEBFORM, UPDATE_WEBFORM, ASSIGN_WEBFORM
api/graphql/subscriptions/webforms.ts → ON_WEBFORM_CREATED, ON_WEBFORM_UPDATED
```

Usar la sintaxis `/* GraphQL */` para resaltar sintaxis con extensiones de editor:
```typescript
export const LIST_CUSTOMERS = /* GraphQL */ `
  query ListCustomers($filter: ListFilter) {
    listCustomers(filter: $filter) {
      items { id rut companyName status createdAt }
      nextToken
    }
  }
`;
```

## Autenticación en el frontend

```typescript
// Obtener usuario actual
import { getCurrentUser, signOut } from "aws-amplify/auth";
const { username, userId } = await getCurrentUser();

// Cerrar sesión
await signOut();

// En componentes — via hook de Authenticator
const { user, signOut } = useAuthenticator();
```

## Vite — configuración

```typescript
// vite.config.ts
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": "/src" },  // imports como "@/store/index"
  },
  define: {
    global: "globalThis",    // requerido por aws-amplify
  },
});
```

## Próximos pasos del frontend

```
[ ] usersSlice.ts       → gestión de usuarios
[ ] webformsSlice.ts    → gestión de webforms + subscriptions
[ ] CustomersPage       → lista + detalle + CRUD
[ ] WebformsPage        → bandeja de entrada + asignación
[ ] UsersPage           → gestión de usuarios (solo ADMIN)
[ ] useSubscription     → hook custom para manejar subscriptions AppSync
[ ] Error boundary      → manejo global de errores UI
```
