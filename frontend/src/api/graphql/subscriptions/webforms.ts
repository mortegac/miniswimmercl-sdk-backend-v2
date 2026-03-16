export const ON_WEBFORM_CREATED = /* GraphQL */ `
  subscription OnWebformCreated {
    onWebformCreated {
      id
      type
      status
      submitterName
      subject
      createdAt
    }
  }
`;

export const ON_WEBFORM_UPDATED = /* GraphQL */ `
  subscription OnWebformUpdated($id: ID) {
    onWebformUpdated(id: $id) {
      id
      status
      assignedTo
      updatedAt
    }
  }
`;
