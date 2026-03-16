export const CREATE_WEBFORM = /* GraphQL */ `
  mutation CreateWebform($input: CreateWebformInput!) {
    createWebform(input: $input) {
      id
      type
      status
      submitterName
      submitterEmail
      subject
      createdAt
    }
  }
`;

export const UPDATE_WEBFORM = /* GraphQL */ `
  mutation UpdateWebform($input: UpdateWebformInput!) {
    updateWebform(input: $input) {
      id
      status
      assignedTo
      resolutionNotes
      resolvedAt
      updatedAt
    }
  }
`;

export const ASSIGN_WEBFORM = /* GraphQL */ `
  mutation AssignWebform($id: ID!, $userId: ID!) {
    assignWebform(id: $id, userId: $userId) {
      id
      status
      assignedTo
      updatedAt
    }
  }
`;
