import {
	VersionedNodeType,
	type INodeTypeBaseDescription,
	type IVersionedNodeType,
} from 'n8n-workflow';

import { sharedBase } from './descriptions';
import { SqlChatMemoryV1 } from './SqlChatMemoryV1.node';
import { SqlChatMemoryV11 } from './SqlChatMemoryV11.node';

const baseDescription: INodeTypeBaseDescription = {
	...sharedBase,
};

/**
 * SQL Chat Memory — versioned entry point (kept at this path so the
 * package manifest and existing installs keep working).
 * v1 is frozen as published in 0.1.0; v1.1 adds Table Mapping, in-node
 * testing and copy-prompt buttons.
 */
export class SqlChatMemory extends VersionedNodeType {
	constructor() {
		const nodeVersions: IVersionedNodeType['nodeVersions'] = {
			1: new SqlChatMemoryV1(),
			1.1: new SqlChatMemoryV11(),
		};
		super(nodeVersions, baseDescription);
	}
}
