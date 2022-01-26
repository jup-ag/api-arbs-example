# Jupiter API arbitrage demo

This is not 100% risk free as transaction may fail but it's a proof of concept to use Jupiter API to do arbitrage

The code show that:
- It check for USDC => SOL, then SOL to USDC, if output amount is more than input amount, then it will do the trades
- It will send minimum 2 transactions and it may fail but it's fine since transaction fee is cheap

![example](/images/example.png)
It shows that it earn 1 cent from the screenshot above
- first transaction use 20 USDC to get 0.21213753 SOL
- second it use 0.21213755 SOL to get 20.01 USDC

So technically it earn less than 1 cent because it use more 0.00000002 SOL but that is insignificant

## How to use?
1. Install dependencies
```sh
pnpm install
```

2.  Just create a `.env` file with your PRIVATE_KEY

3. run the file
```sh
node index.mjs
```