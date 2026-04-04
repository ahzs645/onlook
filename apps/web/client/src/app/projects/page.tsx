'use client';

import { SubscriptionModal } from '@/components/ui/pricing-modal';
import { NonProjectSettingsModal } from '@/components/ui/settings-modal/non-project';
import { env } from '@/env';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { SelectProject } from './_components/select';
import { TopBar } from './_components/top-bar';

const Page = observer(() => {
    const [searchQuery, setSearchQuery] = useState('');
    return (
        <div className="w-screen h-screen flex flex-col">
            <TopBar searchQuery={searchQuery} onSearchChange={setSearchQuery} />
            <div className="flex justify-center w-full h-full overflow-y-auto overflow-x-visible">
                <SelectProject externalSearchQuery={searchQuery} />
            </div>
            {!env.NEXT_PUBLIC_ONLOOK_DESKTOP_MODE && <SubscriptionModal />}
            {!env.NEXT_PUBLIC_ONLOOK_DESKTOP_MODE && <NonProjectSettingsModal />}
        </div>
    );
});

export default Page;
