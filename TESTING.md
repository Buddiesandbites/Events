# Testing checklist

## 1. Run it on your computer
```
python3 -m http.server 8080 --directory public
```
Open http://localhost:8080 (store) and http://localhost:8080/admin/ (admin, demo PIN 1234).
Use the same browser for both, because the demo keeps data in that browser.

## 2. Walk through the store and admin
1. Store: create an account (sample GST number that passes the check: 22AAAAA0000A1Z5), add items, check out with shipping and billing addresses. Note the order ID.
2. Store: Support, raise a ticket, then track it with its ID. Account, send a bulk enquiry.
3. Admin: sign in. The dashboard should show the new order, the open ticket and the pending bulk enquiry.
4. Admin, Products: set a bulk price and a purchase price on a product. Admin, Bulk and customers: approve the enquiry.
5. Store: place a second order as that customer. Admin, Billing: the invoice should use the bulk rate with CGST and SGST. Record a payment.
6. Admin: check Ledger, Tax, Analytics (daily visits), Stock and Offers and posters. Reply to the ticket, then check it in the store.
7. Phone: open the admin address, then Install app (Android) or Share, Add to Home Screen (iPhone). Installing needs the hosted https address.

## 3. Test the Cloudflare API (after deploying the backend)
Replace WORKER with your address and TOKEN with your ADMIN_TOKEN.
```
curl https://WORKER/api/store
curl -X POST https://WORKER/api/signup -H 'content-type: application/json' -d '{"name":"Test","phone":"9000000001","password":"secret1","ship":"Kolkata"}'
curl https://WORKER/api/admin/all                                   # expect 403 Not allowed
curl https://WORKER/api/admin/all -H 'authorization: Bearer TOKEN'  # expect JSON data
curl -X POST https://WORKER/api/admin/product -H 'authorization: Bearer TOKEN' -H 'content-type: application/json' -d '{"name":"Test item","cat":"balloons","retail":100,"bulk":80,"purchase":60,"moq":5,"stock":50}'
curl https://WORKER/api/store                                       # the item appears with retail price only
```

## Known limits
The store and admin do not call the API yet, so data stays in one browser. The admin PIN is a demo PIN.
