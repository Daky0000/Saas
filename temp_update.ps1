$oldStr = @"
      }`)}
        </div>
      </div>

      {/* Active account snapshot */}
      <AccountSnapshot key={activeAccount.id} account={activeAccount} days={days} />
"@

$newStr = @"
      }`)}
        </div>
      </div>

      {/* Active account title */}
      <div className="flex items-center gap-3 pt-2">
        <PlatformLogo platform={activeAccount.platform} size={32} />
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Connected Account</div>
          <h2 className="text-2xl font-black tracking-tight text-slate-950">{activeAccount.account_name || activeAccount.handle || 'Unnamed Account'}</h2>
        </div>
      </div>

      {/* Active account snapshot */}
      <AccountSnapshot key={activeAccount.id} account={activeAccount} days={days} />
"@

$content = Get-Content src/components/analytics/SocialAccountsOverview.tsx -Raw
$newContent = $content.Replace($oldStr, $newStr)
Set-Content src/components/analytics/SocialAccountsOverview.tsx $newContent -NoNewline
Write-Output "Updated SocialAccountsOverview.tsx"
