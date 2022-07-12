Official docs: https://binance-docs.github.io/apidocs/futures/en/#change-log

## Rate Limiting

Docs: https://stackoverflow.com/questions/70240331/what-is-raw-requests-in-binance-api-rate-limit.

Binance has 50 orders per 10 second rate limits on API paths. We can hit this if we get 18 trade entries.
Most trade entries 

Various solution components have been considered, this list is a good base from the TAS perspective:
1. Have a return type for rate limiting
1. If we get a rate limit on a buy order pass it back and don't retry internally
1. Retry stop/exit order creation internally if we hit rate limits after a buy; because the TAS/EE is the component that ensures atomic execution.
1. ... note that it is possible exit order creation fails becuase they would execute immediately, in which case we dump - and the dump order might get rate limited so that needs to retry
1. TAS/EE refuses to start executing an entry if it thinks it can't complete it. This is where we do our real rate limiting, otherwise we can also back up internally and keep smacking the exchange API and retrying. This could be implemented various ways. A key in redis with a 10 second lifetime that is decremeted before a trade entry by the number of calls required to complete the entry seems a nice solution. We refuse to start entering a trade if key goes below 0. 10 second lifetime is set on key creation and not updated. If not set key initialises to 50. We might want to have new entry cut off leave a bit of space to allow for close orders and adding exit orders to pass through.
1. 429's? We can get banned as well as being rate limited. 
1. Funnily enough using the headers - if we get them - returned by the exchange with the remaining number of orders didn't make the list. We only get that value when orders have completed and we want to know it before we start them.


1. ... I guess also we want to reserve orders for things we are retrying internally? Like an entry that is having trouble adding its exit orders .. A queue for orders would probably be a good idea. But we want to package them prioritising completing adding exit orders and probably prioritise close orders a bit above new entries too.
