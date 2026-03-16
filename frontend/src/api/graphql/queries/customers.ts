export const GET_CUSTOMER = /* GraphQL */ `
  query GetCustomer($id: ID!) {
    getCustomer(id: $id) {
      id
      rut
      companyName
      tradeName
      email
      phone
      status
      elevatorCount
      contractStartDate
      contractEndDate
      notes
      address {
        street
        number
        city
        region
        country
      }
      contacts {
        name
        email
        phone
        role
        isPrimary
      }
      createdAt
      updatedAt
    }
  }
`;

export const LIST_CUSTOMERS = /* GraphQL */ `
  query ListCustomers($filter: ListFilter) {
    listCustomers(filter: $filter) {
      items {
        id
        rut
        companyName
        tradeName
        email
        phone
        status
        elevatorCount
        createdAt
      }
      nextToken
      total
    }
  }
`;

export const SEARCH_CUSTOMERS = /* GraphQL */ `
  query SearchCustomers($query: String!, $filter: ListFilter) {
    searchCustomers(query: $query, filter: $filter) {
      items {
        id
        rut
        companyName
        email
        status
        elevatorCount
      }
      nextToken
    }
  }
`;
