export const CREATE_CUSTOMER = /* GraphQL */ `
  mutation CreateCustomer($input: CreateCustomerInput!) {
    createCustomer(input: $input) {
      id
      rut
      companyName
      email
      status
      createdAt
    }
  }
`;

export const UPDATE_CUSTOMER = /* GraphQL */ `
  mutation UpdateCustomer($input: UpdateCustomerInput!) {
    updateCustomer(input: $input) {
      id
      rut
      companyName
      tradeName
      email
      phone
      status
      elevatorCount
      updatedAt
    }
  }
`;

export const DELETE_CUSTOMER = /* GraphQL */ `
  mutation DeleteCustomer($id: ID!) {
    deleteCustomer(id: $id)
  }
`;
