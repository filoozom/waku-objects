import pDefer, { DeferredPromise } from "p-defer";
import { DataMessage, JSONSerializable, Token, TokenSchema, TransactionSchema, TransactionStateSchema, WakuObjectAdapter, WakuObjectArgs, WakuObjectContext, WakuObjectContextProps, WakuObjectState } from './types'
import { Contract } from "ethers";

interface AdapterRequestMessage {
  type: 'adapter'
  function: string
  id: string
  args: string[]
}

interface AdapterResponseSuccess {
  type: 'success'
  value: JSONSerializable | undefined
}

interface AdapterResponseError {
  type: 'error'
  value: unknown
}

type AdapterResponseResult = AdapterResponseSuccess | AdapterResponseError

interface AdapterResponseMessage {
  type: 'adapter'
  id: string
  result: AdapterResponseResult
}

export interface IframeDataMessage {
	type: 'iframe-data-message'
	message: DataMessage
  state: WakuObjectState
  context: WakuObjectContextProps
}

export interface IframeContextChange {
  type: 'iframe-context-change'
  state: WakuObjectState
  context: WakuObjectContextProps
}

// Store
const promiseMap = new Map<string, DeferredPromise<JSONSerializable | undefined>>();

// NOTE: Probably good enough?
const generateRandomValue = (): string => {
  return Math.random().toString();
};

const adapterFunction = (name: string) => (...args: string[]) => {
  const id = generateRandomValue();
  const defer = pDefer<JSONSerializable | undefined>();

  const message: AdapterRequestMessage = {
    type: "adapter",
    function: name,
    id,
    args,
  }

  // Post message to parent
  // TODO replace targetOrigin
  parent.postMessage(message, { targetOrigin: '*' });

  // Map deferred promise to id
  promiseMap.set(id, defer);

  // Return promise
  return defer.promise;
};

function isIframeDataMessage(message: any): message is IframeDataMessage {
  return typeof message == "object" && message?.type === "iframe-data-message"
}

function isIframeContextChange(message: any): message is IframeContextChange {
  return typeof message == "object" && message?.type === 'iframe-context-change'
}

const isAdapterResponseMessage = (message: any): message is AdapterResponseMessage => {
  return typeof message == "object" && message?.type === "adapter" && typeof message?.id === 'string';
};


export function makeWakuObjectAdapter(): WakuObjectAdapter {
  async function getTransaction(txHash: string) {
    const response = await adapterFunction('getTransaction')(txHash)
    if (!response) {
      throw 'invalid response'
    }

    const result = TransactionSchema.safeParse(response)
    if (!result.success) {
      throw 'invalid response'
    }

    return result.data
  }

  async function getTransactionState(txHash: string) {
    const response = await adapterFunction('getTransactionState')(txHash)
    if (!response) {
      throw 'invalid response'
    }

    const result = TransactionStateSchema.safeParse(response)
    if (!result.success) {
      throw 'invalid response'
    }

    return result.data
  }

  async function waitForTransaction(txHash: string) {
    const response = await adapterFunction('waitForTransaction')(txHash)
    if (!response) {
      throw 'invalid response'
    }

    const result = TransactionStateSchema.safeParse(response)
    if (!result.success) {
      throw 'invalid response'
    }

    return result.data
  }

  async function checkBalance(token: Token) {
    await adapterFunction('checkBalance')(JSON.stringify(token))
  }

  async function sendTransaction(to: string, token: Token) {
    const response = await adapterFunction('sendTransaction')(to, JSON.stringify(token))
    if (!response) {
      throw 'invalid response'
    }

    if (typeof response !== 'string') {
      throw 'invalid response'
    }

    return response
  }

  async function estimateTransaction(to: string, token: Token) {
    const response = await adapterFunction('sendTransaction')(to, JSON.stringify(token))
    if (!response) {
      throw 'invalid response'
    }

    const result = TokenSchema.safeParse(response)
    if (!result.success) {
      throw 'invalid response'
    }

    return result.data
  }

  function getContract(): Contract {
    throw 'not implemented'
  }

  return {
    getTransaction,
    getTransactionState,
    waitForTransaction,
    checkBalance,
    sendTransaction,
    estimateTransaction,
    getContract,
  }
}

export function makeWakuObjectContext(adapter: WakuObjectAdapter, contextProps?: Partial<WakuObjectContextProps>): WakuObjectContext {
  async function send(data: JSONSerializable) {
    const response = await adapterFunction('send')(JSON.stringify(data))
    if (!response) {
      throw 'invalid response'
    }
  }

  async function updateStore(updater: (store?: JSONSerializable) => JSONSerializable) {
    const store = await adapterFunction('getStore')()
    if (!store) {
      throw 'invalid response'
    }
    const newStore = updater(store)
    await adapterFunction('setStore')(JSON.stringify(newStore))
  }

  function onViewChange(view: string) {
    adapterFunction('onViewChange')(view)
  }

  return {
    ...adapter,
    ...contextProps,
    send,
    updateStore,
    onViewChange,
  }
}

interface EventListenerOptions {
  onDataMessage: (dataMessage: DataMessage, args: WakuObjectArgs) => Promise<void>
  onArgsChange: (args: WakuObjectArgs) => Promise<void>
}

export function startEventListener(options: Partial<EventListenerOptions>) {
  // Start listener
  window.addEventListener("message", (event) => {
    // Check if the message came from the parent (chat app)
    /*
    if (event.origin !== "null" || event.source !== parent.contentWindow) {
      return;
    }
    */

    const { data } = event;

    if (isIframeDataMessage(data)) {
      if (options.onDataMessage) {
        const message = data.message as DataMessage
        const adapter = makeWakuObjectAdapter()
        const context = makeWakuObjectContext(adapter, data.context)
        const args: WakuObjectArgs = {
          ...context,
          ...data.state
        }
          options.onDataMessage(message, args)
      }
      return
    }

    if (isIframeContextChange(data)) {
      if (options.onArgsChange) {
        const adapter = makeWakuObjectAdapter()
        const context = makeWakuObjectContext(adapter, data.context)
        const args: WakuObjectArgs = {
          ...context,
          ...data.state
        }
        options.onArgsChange(args)
      }
      return
    }

    if (!isAdapterResponseMessage(data)) {
      return;
    }

    const defer = promiseMap.get(data.id);
    if (!defer) {
      throw new Error("Deferred Promise not found");
    }

    promiseMap.delete(data.id)

    if (data.result.type === 'error') {
      defer.reject(data.result.value)
      return
    }

    defer.resolve(data.result.value);
  });

  // send `init` message after object side initialization is complete
  // the host application will respond with the updated context
  parent.postMessage({ type: 'init' }, '*')
}

export function updateSize() {
  const { scrollWidth, scrollHeight } = document.body
  parent.postMessage(
    {
      type: 'window-size',
      scrollWidth,
      scrollHeight,
    },
    '*',
  )
}