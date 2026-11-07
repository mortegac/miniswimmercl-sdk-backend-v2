
##  Creacion de usuario usando la terminal

  ---
```
  aws cognito-idp admin-create-user \
    --user-pool-id <TU_USER_POOL_ID> \
    --username admin@miniswimmer.cl \
    --temporary-password "Temp1234!" \
    --user-attributes Name=email,Value=admin@miniswimmer.cl Name=email_verified,Value=true \
    --profile miniswimmer \
    --region us-east-2
```