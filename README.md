Setup shell alias for shorter commands:

```bash
alias shelly='npx -y gxe@latest AnEntrypoint/shelly cli'
```

Then use: `shelly connect`, `shelly send`, `shelly status`, `shelly disconnect`

Full commands without alias:
```
npx -y gxe@latest AnEntrypoint/shelly cli serve --seed <your seed>
npx -y gxe@latest AnEntrypoint/shelly cli connect --seed <same seed>
npx -y gxe@latest AnEntrypoint/shelly cli send --text "command"
npx -y gxe@latest AnEntrypoint/shelly cli status
npx -y gxe@latest AnEntrypoint/shelly cli disconnect
```
