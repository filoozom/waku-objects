<script lang="ts">
  import { startEventListener, updateSize } from "@waku-objects/adapter"
  import type { DataMessage, WakuObjectArgs } from "@waku-objects/adapter/dist/types";
  import { afterUpdate, onMount } from "svelte";

  let args: WakuObjectArgs
  let message: DataMessage

  onMount(() => {
    startEventListener({ 
      onArgsChange: async (args_) => {
        args = args_
      },
      onDataMessage: async (message_, args_) => {
        args = args_
        message = message_
      }
    })
  })

  afterUpdate(() => {
    updateSize()
  })

  async function action() {
    if (args) {
      const transaction = await args.getTransaction('0x46593fe25fadddd0bb3feb3017b8745a471d61e5c650c3dc5c0920f46216d0b6')
      console.debug('sandbox-example: action', { transaction })
    }
  }
</script>

<div>
  <button on:click={() => action()}>Sandbox example</button>
</div>
