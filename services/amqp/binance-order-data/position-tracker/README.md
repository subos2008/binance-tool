# Position Tracker (WIP)

See One Note for design notes.

First iteration goal:

1. Tracks the entry price of new positions
2. Closes out a position when holdings get to zero, negative, < $50
3. Watches the price for open positions. Alerts when 30% up from entry

## Details

### Tracks the entry price of new positions

By watching buy orders and creating a new Position when it sees a buy order for a symbol it's not aware of us holding already

## Data Stored

Position:
1. Entry timestamp
1. Entry Price
1. Position size
1. Exchange and account

## Data Streams / Events Watched

1. Orders from exchanges
1. Price stream. Note this would be `binance-spot`

# Separation of Concerns

It would make sense to split exchange specific code from the code that stores the position information. 

This could be done at the order stream level by watching `order-tracker` events

It could also be done by having exchange specific services that include generic code via callbacks. 
