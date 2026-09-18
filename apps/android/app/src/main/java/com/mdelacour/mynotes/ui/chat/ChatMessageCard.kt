package com.mdelacour.mynotes.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.mdelacour.mynotes.ai.contract.ChatMessage
import com.mdelacour.mynotes.ai.contract.ChatRole
import com.mdelacour.mynotes.ai.contract.MessageStatus

@Composable
fun ChatMessageCard(
	message: ChatMessage,
	canRevert: Boolean,
	onRevert: () -> Unit,
	modifier: Modifier = Modifier,
) {
	val text = message.text()
	val calls = message.toolCalls()
	Surface(
		modifier = modifier.fillMaxWidth(),
		shape = RoundedCornerShape(8.dp),
		color = if (message.role == ChatRole.USER) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface,
	) {
		Column(
			modifier = Modifier.padding(10.dp),
			verticalArrangement = Arrangement.spacedBy(4.dp),
		) {
			Row(
				modifier = Modifier.fillMaxWidth(),
				horizontalArrangement = Arrangement.spacedBy(6.dp),
				verticalAlignment = Alignment.CenterVertically,
			) {
				Text(
					text = if (message.role == ChatRole.USER) "You" else "Assistant",
					style = MaterialTheme.typography.labelSmall,
				)
				if (message.status == MessageStatus.INTERRUPTED) {
					Text("interrupted", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
				} else if (message.status == MessageStatus.FAILED) {
					Text("failed", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
				} else if (message.status == MessageStatus.STOPPED) {
					Text("stopped", style = MaterialTheme.typography.labelSmall)
				}
				message.model?.let { Text(it, style = MaterialTheme.typography.labelSmall) }
			}
			if (text.isNotEmpty()) {
				Text(text = text, style = MaterialTheme.typography.bodyMedium)
			}
			for (call in calls) {
				Text("• ${call.name.wire}", style = MaterialTheme.typography.labelSmall)
			}
			val usage = message.usage
			if (usage != null) {
				val parts = buildList {
					usage.inputTokens?.let { add("$it in") }
					usage.outputTokens?.let { add("$it out") }
					usage.cachedInputTokens?.let { if (it > 0) add("$it cached") }
				}
				if (parts.isNotEmpty()) {
					Text("${parts.joinToString(" · ")} tokens", style = MaterialTheme.typography.labelSmall)
				}
			}
			if (message.mutationJournalId != null && canRevert) {
				TextButton(onClick = onRevert) { Text("Revert changes") }
			}
		}
	}
}
