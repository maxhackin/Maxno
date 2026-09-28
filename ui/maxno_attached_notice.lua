-- Rewrite Xeno's built-in Roblox toast into Maxno + bob.jpg
task.spawn(function()
	local CoreGui = game:GetService("CoreGui")
	local StarterGui = game:GetService("StarterGui")
	local Players = game:GetService("Players")

	local bobAsset = nil
	if typeof(getcustomasset) == "function" then
		local ok, asset = pcall(getcustomasset, "maxno_bob.jpg")
		if ok and typeof(asset) == "string" and #asset > 0 then
			bobAsset = asset
		end
	end

	local function looksLikeXenoToast(text)
		if typeof(text) ~= "string" then return false end
		local t = string.lower(text)
		return string.find(t, "xeno", 1, true) ~= nil
			or t == "attached"
			or string.find(t, "attached", 1, true) ~= nil
	end

	local function restyleNotificationRoot(root)
		if not root or root:GetAttribute("MaxnoRestyled") then return end
		local touched = false
		for _, d in ipairs(root:GetDescendants()) do
			if d:IsA("TextLabel") or d:IsA("TextButton") then
				if looksLikeXenoToast(d.Text) then
					touched = true
					if string.lower(d.Text) == "xeno" or string.find(string.lower(d.Text), "xeno", 1, true) then
						d.Text = "MAXNO"
					end
					if string.find(string.lower(d.Text), "attach", 1, true) then
						d.Text = "MAXNO ATTACHED :3"
					end
				end
			elseif d:IsA("ImageLabel") or d:IsA("ImageButton") then
				if bobAsset then
					-- only replace icons inside a toast we already identified
					-- deferred: mark later
				end
			end
		end
		if touched then
			root:SetAttribute("MaxnoRestyled", true)
			if bobAsset then
				for _, d in ipairs(root:GetDescendants()) do
					if d:IsA("ImageLabel") or d:IsA("ImageButton") then
						pcall(function()
							d.Image = bobAsset
							d.ImageContent = nil
						end)
						pcall(function()
							d.Image = bobAsset
						end)
					end
				end
			end
			-- force the main title/body if structure is Title+Text
			local texts = {}
			for _, d in ipairs(root:GetDescendants()) do
				if (d:IsA("TextLabel") or d:IsA("TextButton")) and d.Text and #d.Text > 0 then
					table.insert(texts, d)
				end
			end
			table.sort(texts, function(a, b)
				return (a.TextSize or 0) > (b.TextSize or 0)
			end)
			if texts[1] then texts[1].Text = "MAXNO" end
			if texts[2] then texts[2].Text = "MAXNO ATTACHED :3" end
			if #texts == 1 then texts[1].Text = "MAXNO ATTACHED :3" end
		end
	end

	local function scan(container)
		if not container then return end
		for _, child in ipairs(container:GetDescendants()) do
			if child:IsA("TextLabel") or child:IsA("TextButton") then
				if looksLikeXenoToast(child.Text) then
					-- climb a few parents to the toast frame
					local root = child
					for _ = 1, 6 do
						if root.Parent and root.Parent ~= CoreGui then
							root = root.Parent
						end
					end
					restyleNotificationRoot(root)
				end
			end
		end
	end

	-- Watch for the stock toast
	local conn
	conn = CoreGui.DescendantAdded:Connect(function(desc)
		task.defer(function()
			pcall(function()
				if desc:IsA("TextLabel") or desc:IsA("TextButton") then
					if looksLikeXenoToast(desc.Text) then
						local root = desc
						for _ = 1, 6 do
							if root.Parent and root.Parent ~= CoreGui then
								root = root.Parent
							end
						end
						restyleNotificationRoot(root)
					end
				elseif desc:IsA("Frame") or desc:IsA("ImageLabel") then
					scan(desc)
				end
			end)
		end)
	end)

	-- Initial scan + a few retries (toast can spawn slightly later)
	for i = 1, 20 do
		pcall(scan, CoreGui)
		task.wait(0.15)
	end

	-- Also fire our own Roblox-style toast with bob icon
	task.wait(0.2)
	pcall(function()
		local payload = {
			Title = "MAXNO",
			Text = "MAXNO ATTACHED :3",
			Duration = 5,
		}
		if bobAsset then
			payload.Icon = bobAsset
		end
		StarterGui:SetCore("SendNotification", payload)
	end)

	-- stop watching after a bit so we don't restyle unrelated toasts forever
	task.delay(12, function()
		if conn then conn:Disconnect() end
	end)
end)
