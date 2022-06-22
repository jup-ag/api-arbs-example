import dotenv from "dotenv";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  Transaction,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import got from "got";
import { Wallet } from "@project-serum/anchor";
import promiseRetry from "promise-retry";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Token,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

console.log({ dotenv });
dotenv.config();

const getRpcEndPoint = () => {
    // If RPC_END_POINT is not defined it will default to a free Solana RPC endpoint.
    // It may have ratelimit and sometimes invalid cache. It is recommended to use a  paid RPC endpoint.
    return process.env?.RPC_END_POINT || "https://solana-api.projectserum.com";
}
const connection = new Connection(getRpcEndPoint());
const wallet = new Wallet(
  Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY || ""))
);

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT = "So11111111111111111111111111111111111111112";

// wsol account
const createWSolAccount = async () => {
  const wsolAddress = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    new PublicKey(SOL_MINT),
    wallet.publicKey
  );

  const wsolAccount = await connection.getAccountInfo(wsolAddress);

  if (!wsolAccount) {
    const transaction = new Transaction({
      feePayer: wallet.publicKey,
    });
    const instructions = [];

    instructions.push(
      await Token.createAssociatedTokenAccountInstruction(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        new PublicKey(SOL_MINT),
        wsolAddress,
        wallet.publicKey,
        wallet.publicKey
      )
    );

    // fund 1 sol to the account
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: wsolAddress,
        lamports: 1_000_000_000, // 1 sol
      })
    );

    instructions.push(
      // This is not exposed by the types, but indeed it exists
      Token.createSyncNativeInstruction(TOKEN_PROGRAM_ID, wsolAddress)
    );

    transaction.add(...instructions);
    transaction.recentBlockhash = await (
      await connection.getRecentBlockhash()
    ).blockhash;
    transaction.partialSign(wallet.payer);
    const result = await connection.sendTransaction(transaction, [
      wallet.payer,
    ]);
    console.log({ result });
  }

  return wsolAccount;
};

const getCoinQuote = (inputMint, outputMint, amount) =>
  got
    .get(
      `https://quote-api.jup.ag/v1/quote?outputMint=${outputMint}&inputMint=${inputMint}&amount=${amount}&slippage=0.01`
    )
    .json();

const getTransaction = (route) => {
  return got
    .post("https://quote-api.jup.ag/v1/swap", {
      json: {
        route: route,
        userPublicKey: wallet.publicKey.toString(),
        // to make sure it doesnt close the sol account
        wrapUnwrapSOL: false,
      },
    })
    .json();
};

const getConfirmTransaction = async (txid) => {
  const res = await promiseRetry(
    async (retry, attempt) => {
      let txResult = await connection.getTransaction(txid, {
        commitment: "confirmed",
      });

      if (!txResult) {
        const error = new Error("Transaction was not confirmed");
        error.txid = txid;

        retry(error);
        return;
      }
      return txResult;
    },
    {
      retries: 40,
      minTimeout: 500,
      maxTimeout: 1000,
    }
  );
  if (res.meta.err) {
    throw new Error("Transaction failed");
  }
  return txid;
};

// require wsol to start trading, this function create your wsol account and fund 1 SOL to it
await createWSolAccount();

// initial 20 USDC for quote
const initial = 200_000_000;
const initialDecimal = 200;
const solTransactionFee = 0.000005;
var totalProfit = 0;
var iterationsTotal = 0;
var successfulAttempts = 0;
var failedAttempts = 0;
var transactionProfit = 0;
var transactionsAttempted = 0;
var solSpentOnTransactions = 0;
while (true) {
  // 0.1 SOL
  iterationsTotal++;
  transactionProfit = 0;
  const usdcToSol = await getCoinQuote(USDC_MINT, SOL_MINT, initial);
  const solToUsdc = await getCoinQuote( SOL_MINT,  USDC_MINT, usdcToSol.data[0].outAmount);
  const outAmount = solToUsdc.data[0].outAmount;
  console.log( `_LOG_: USDC_TO_SOL ->  ${usdcToSol.data[0].outAmount} | SOL_TO_USDC ->  ${outAmount} | SOL_USDC_W_SLIPPAGE -> ${solToUsdc.data[0].outAmountWithSlippage}`);
  // when outAmount more than initial
  if (outAmount > initial) {
      transactionsAttempted++;
      await Promise.all(
      [usdcToSol.data[0], solToUsdc.data[0]].map(async (route) => {
        const { setupTransaction, swapTransaction, cleanupTransaction } =
          await getTransaction(route);
        await Promise.all(
          [setupTransaction, swapTransaction, cleanupTransaction]
            .filter(Boolean)
            .map(async (serializedTransaction) => {
              // get transaction object from serialized transaction
              const transaction = Transaction.from(
                Buffer.from(serializedTransaction, "base64")
              );
              // perform the swap
              // Transaction might failed or dropped
              const txid = await connection.sendTransaction(
                transaction,
                [wallet.payer],
                {
                  skipPreflight: true,
                }
              );
              try {
                await getConfirmTransaction(txid);
                  console.log(`Success: https://solscan.io/tx/${txid}`);
                  successfulAttempts++;
                  solSpentOnTransactions+=solTransactionFee;
              } catch (e) {
                console.log(`Failed: https://solscan.io/tx/${txid}`);
                failedAttempts++;
                solSpentOnTransactions+=solTransactionFee;
              }
            })
        );
      })
    );
      transactionProfit = (solToUsdc.data[0].outAmount / 1000000) - initialDecimal;
      totalProfit += transactionProfit;
  }
    console.log(
      `Iteration #: ${iterationsTotal} | Transactions attempted ${transactionsAttempted} | Successful transactions: ${successfulAttempts} 
      | Failed transactions: ${failedAttempts} | Attempted profit: ${transactionProfit} | Total attempted profit: ${totalProfit} | 
      Fees: ${solSpentOnTransactions} sol`
    );
    console.log("---------------------------------------------------------------------------------------------------------------------------------------------------------");
}

